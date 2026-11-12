import { evidence, type Job, repos } from "@foundry/db";
import type { CiState, GhPullRequest } from "@foundry/github";
import { errorFields, type PrReviewContext, type PrReviewRequest, renderPrReviewBody } from "@foundry/shared";
import { eq } from "drizzle-orm";
import { bestEffort, type ControlContext } from "./context";
import { repoRef } from "./github-sync";
import { addInput, getJob, recordEvents, transitionJob } from "./jobs";
import { repoPolicy } from "./repos";

/**
 * How long a PR must sit in `pr_ci` before `ci === "none"` is treated as "this repo has no
 * checks". It gives GitHub time to register a check suite or external CI to post a status; without
 * it the worker could review the PR before CI exists and mark the head SHA as reviewed.
 */
export const NO_CI_GRACE_MS = 2 * 60_000;

/**
 * Start the automatic post-PR review exactly once per PR head. Called by the confidence gate
 * whenever a job in `pr_ci` has a settled CI result. Returns true when the job was re-queued.
 */
export async function maybeStartPrReview(
  ctx: ControlContext,
  job: Job,
  headSha: string,
  ci: CiState,
  opts: { allowNoCi?: boolean } = {},
): Promise<boolean> {
  if (job.kind !== "ticket" || job.status !== "pr_ci" || job.prNumber === null) return false;
  // Wait for CI to settle. A repo that registers no checks at all would otherwise never review;
  // the worker passes `allowNoCi` once the PR has been in `pr_ci` past the grace period.
  const settled = ci === "success" || ci === "failure";
  if (!settled) {
    if (!(opts.allowNoCi && ci === "none")) return false;
    const entered = job.prCiEnteredAt?.getTime() ?? 0;
    if (ctx.now().getTime() - entered < NO_CI_GRACE_MS) return false;
  }
  if (job.prReviewSha === headSha) return false;
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (!repo || !repoPolicy(repo).auto_pr_review) return false;
  const moved = await transitionJob(ctx, job.id, "queued", {
    reason: settled
      ? "PR CI finished; starting the automatic review"
      : "No CI checks; starting the automatic review",
    from: ["pr_ci"],
    // Pin both the reviewed SHA and the job head: the live PR head may have moved since open.
    patch: {
      resumeStage: "pr_review",
      prReviewSha: headSha,
      headSha,
      lastCompletedStage: "verifying",
    },
  });
  if (!moved) return false;
  ctx.log.info("auto PR review queued", { jobId: job.id, pr: job.prNumber, headSha, ci });
  return true;
}

/** The PR head and failed checks the runner needs to review. */
export async function prReviewContext(
  ctx: ControlContext,
  job: Pick<Job, "prNumber" | "prUrl" | "headSha" | "prReviewSha" | "repoId">,
): Promise<PrReviewContext | null> {
  if (job.prNumber === null) return null;
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (!repo) return null;
  const ref = repoRef(repo);
  let pr: GhPullRequest | null = null;
  try {
    pr = await ctx.gh.getPullRequest(ref, job.prNumber);
  } catch (err) {
    // A transient GitHub failure must not strand the claim; review the SHA the job recorded.
    ctx.log.warn("auto PR review: could not read the pull request", { ...errorFields(err) });
  }
  // `prReviewSha` is the SHA the review was queued for; prefer it over a possibly stale job head.
  const headSha = job.prReviewSha ?? job.headSha ?? pr?.headSha;
  if (!headSha) return null;
  let ciFailures: PrReviewContext["ciFailures"] = [];
  try {
    ciFailures = await ctx.gh.checkFailures(ref, headSha);
  } catch (err) {
    // A review without CI detail is still useful; the agent can inspect the branch itself.
    ctx.log.warn("auto PR review: could not read failed checks", { ...errorFields(err) });
  }
  return { prNumber: job.prNumber, url: pr?.url ?? job.prUrl ?? "", headSha, ciFailures };
}

/**
 * Record the reviewer's verdict, publish it on the PR, and move the job on: approve → `pr_ci`
 * (the caller re-evaluates the gate), request changes → `implementing` with the findings as a
 * message, or `waiting_on_you` once the review loop budget is spent.
 */
export async function submitPrReview(ctx: ControlContext, job: Job, report: PrReviewRequest): Promise<Job> {
  if (job.prNumber === null) throw new Error("the job has no pull request to review");
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (!repo) throw new Error("repo not found");
  const policy = repoPolicy(repo);
  const ref = repoRef(repo);
  const blocking = report.verdict === "request_changes";
  const body = renderPrReviewBody(report);
  // The Foundry App authors the PR, and GitHub does not let a PR author approve or request
  // changes on it. A COMMENT review carries the verdict in the body and inline comments.
  const comments = report.findings.flatMap((f) =>
    f.file && f.line ? [{ path: f.file, line: f.line, body: `[${f.severity}] ${f.message}` }] : [],
  );
  await bestEffort(ctx, "submit pull request review", () =>
    ctx.gh.createReview(ref, job.prNumber!, {
      body,
      event: "COMMENT",
      comments,
      commitId: job.headSha ?? undefined,
    }),
  );
  await ctx.db.insert(evidence).values({
    jobId: job.id,
    kind: "review",
    name: "code review",
    status: blocking ? "failed" : "passed",
    outputTail: body.slice(0, 20_000),
    loop: job.loopCount,
  });
  const risk = report.risk ? ` Merge risk: ${report.risk.level} — ${report.risk.summary}` : "";
  await recordEvents(ctx, job, [
    {
      kind: "message",
      role: "system",
      text: `Automatic PR review: ${blocking ? "changes requested" : "approved"}. ${report.summary}${risk}`,
    },
  ]);
  ctx.log.info("auto PR review reported", {
    jobId: job.id,
    pr: job.prNumber,
    verdict: report.verdict,
    risk: report.risk?.level ?? null,
    findings: report.findings.length,
  });

  if (!blocking) {
    const approved = await transitionJob(ctx, job.id, "pr_ci", {
      reason: "automatic PR review approved the change",
      from: ["pr_review"],
      patch: { prCiEnteredAt: ctx.now() },
    });
    return approved ?? getJob(ctx, job.id);
  }

  const count = job.prReviewCount + 1;
  if (count <= policy.max_review_loops) {
    const text =
      `The automatic PR review of your pull request requested changes ` +
      `(round ${count} of ${policy.max_review_loops}). Fix every blocking finding, then continue ` +
      `the playbook.\n\n${body}`;
    await addInput(ctx, job, { kind: "message", text, by: "foundry[bot]" });
    const requeued = await transitionJob(ctx, job.id, "queued", {
      reason: `automatic PR review requested changes (round ${count})`,
      from: ["pr_review"],
      patch: { resumeStage: "implementing", prReviewCount: count },
    });
    return requeued ?? getJob(ctx, job.id);
  }

  const handed = await transitionJob(ctx, job.id, "waiting_on_you", {
    reason: `automatic PR review still requests changes after ${count} rounds`,
    from: ["pr_review"],
    patch: { prReviewCount: count },
  });
  if (handed) {
    ctx.log.info("auto PR review loop budget spent", { jobId: job.id, rounds: count });
    await bestEffort(ctx, "request reviewers", () =>
      ctx.gh.requestReviewers(ref, job.prNumber!, job.authorLogin ? [job.authorLogin] : [], []),
    );
    await ctx.notifier.notify(ctx, { event: "handover", job: handed, detail: report.summary });
  }
  return handed ?? getJob(ctx, job.id);
}
