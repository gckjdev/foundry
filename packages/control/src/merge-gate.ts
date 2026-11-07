import { evidence, type Job, jobs, repos } from "@foundry/db";
import {
  type ConfidenceLevel,
  diffFromGitHubFiles,
  evaluateGate,
  type FoundryEvent,
  type GateResult,
  matchRiskRules,
  splitReviewers,
} from "@foundry/shared";
import { desc, eq } from "drizzle-orm";
import { bestEffort, type ControlContext } from "./context";
import { repoRef } from "./github-sync";
import { getJob, recordEvents, transitionJob } from "./jobs";
import { effectiveMergeMode, repoPolicy, repoRecipe } from "./repos";

/** Latest evidence per (kind, name) for the job's current verify loop. */
export async function latestEvidence(ctx: ControlContext, job: Pick<Job, "id" | "loopCount">) {
  const rows = await ctx.db
    .select()
    .from(evidence)
    .where(eq(evidence.jobId, job.id))
    .orderBy(desc(evidence.createdAt));
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.kind}:${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Evaluate the confidence gate (spec 5.5) for a job whose PR is open, then merge, hand over with
 * routed reviewers, or keep waiting for CI / AI review. Safe to call on every CI or review event.
 */
export async function evaluateJobGate(ctx: ControlContext, jobId: string): Promise<GateResult | null> {
  const job = await getJob(ctx, jobId);
  if (job.status !== "pr_ci" || job.prNumber === null) return null;
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (!repo) return null;
  const ref = repoRef(repo);
  const policy = repoPolicy(repo);
  const recipe = repoRecipe(repo);

  const pr = await ctx.gh.getPullRequest(ref, job.prNumber);
  if (pr.merged) {
    await transitionJob(ctx, job.id, "merged", { reason: "pull request merged", from: ["pr_ci"] });
    return null;
  }
  const [files, ci, reviews, ev] = await Promise.all([
    ctx.gh.listPullRequestFiles(ref, job.prNumber),
    ctx.gh.ciState(ref, pr.headSha),
    ctx.gh.listReviews(ref, job.prNumber),
    latestEvidence(ctx, job),
  ]);
  const diff = diffFromGitHubFiles(files);
  const botReviews = reviews.filter((r) => policy.ai_review_bots.includes(r.author));
  const lastBot = botReviews.at(-1);
  const confidence = job.confidence as { level: ConfidenceLevel; uncertainties: string[] } | null;
  const riskMatches = matchRiskRules(diff, policy.risk_rules);

  const result = evaluateGate({
    mergeMode: job.kind === "onboarding" ? "off" : effectiveMergeMode(repo),
    policy,
    requiredChecks: recipe?.checks.map((c) => c.name) ?? [],
    evidence: ev.map((e) => ({
      kind: e.kind,
      name: e.name,
      status: e.status as "passed" | "failed" | "skipped",
    })),
    uiChanged: job.uiChanged,
    ci,
    aiReview: { present: !!lastBot, blocking: lastBot?.state === "CHANGES_REQUESTED" },
    riskMatches,
    changedLines: diff.changedLines,
    confidence: confidence
      ? { level: confidence.level, uncertainties: confidence.uncertainties ?? [] }
      : null,
    costUsd: job.costUsd,
  });

  await ctx.db
    .update(jobs)
    .set({ gateResult: result, ciStatus: ci, headSha: pr.headSha, changedLines: diff.changedLines })
    .where(eq(jobs.id, job.id));
  if (result.pending) return result;
  const gateEvent: FoundryEvent = { kind: "gate", pass: result.pass, failed: result.failed };
  await recordEvents(ctx, job, [gateEvent]);

  if (result.pass) {
    await ctx.gh.mergePullRequest(ref, job.prNumber, "squash");
    const merged = await transitionJob(ctx, job.id, "merged", {
      reason: "confidence gate passed",
      from: ["pr_ci"],
    });
    if (merged) await ctx.notifier.notify(ctx, { event: "merged", job: merged, detail: "auto-merged" });
    return result;
  }

  // Hand over: risk-rule reviewers first; otherwise the ticket author reviews.
  const handles = result.reviewers.length > 0 ? result.reviewers : job.authorLogin ? [job.authorLogin] : [];
  const { users, teams } = splitReviewers(handles);
  await bestEffort(ctx, "request reviewers", () => ctx.gh.requestReviewers(ref, job.prNumber!, users, teams));
  const detail = result.failed.map((f) => f.detail).join("; ");
  const handed = await transitionJob(ctx, job.id, "waiting_on_you", {
    reason: detail,
    from: ["pr_ci"],
    patch: { assignedReviewers: handles.map((h) => h.replace(/^@/, "")) },
  });
  if (handed) await ctx.notifier.notify(ctx, { event: "handover", job: handed, detail });
  return result;
}

/** Jobs whose open PR has this head commit (for check_run / status webhooks). */
export async function jobsForSha(ctx: ControlContext, sha: string) {
  return ctx.db.select().from(jobs).where(eq(jobs.headSha, sha));
}
