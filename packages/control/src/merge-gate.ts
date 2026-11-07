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
import { desc, eq, inArray } from "drizzle-orm";
import { bestEffort, type ControlContext } from "./context";
import { repoRef } from "./github-sync";
import { getJob, recordEvents, transitionJob } from "./jobs";
import { effectiveMergeMode, refreshRepoConfig, repoPolicy, repoRecipe } from "./repos";

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
 * A human (or GitHub) merged the PR. Move `pr_ci` / `waiting_on_you` to merged and, for onboarding,
 * re-read `.foundry/` from the default branch so the repo starts accepting jobs.
 */
export async function markJobMerged(
  ctx: ControlContext,
  job: Pick<Job, "id" | "kind" | "repoId">,
  reason: string,
  notifyDetail = "merged",
): Promise<Job | null> {
  const merged = await transitionJob(ctx, job.id, "merged", {
    reason,
    from: ["pr_ci", "waiting_on_you"],
  });
  if (!merged) return null;
  await ctx.notifier.notify(ctx, { event: "merged", job: merged, detail: notifyDetail });
  if (merged.kind === "onboarding") {
    const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, merged.repoId) });
    if (repo) await refreshRepoConfig(ctx, repo);
  }
  return merged;
}

/** If GitHub already merged this job's PR (webhook missed), record it. */
export async function syncMergedPullRequest(ctx: ControlContext, job: Job): Promise<Job | null> {
  if (job.prNumber === null) return null;
  if (job.status !== "pr_ci" && job.status !== "waiting_on_you") return null;
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (!repo) return null;
  try {
    const pr = await ctx.gh.getPullRequest(repoRef(repo), job.prNumber);
    if (!pr.merged) return null;
  } catch {
    return null;
  }
  return markJobMerged(ctx, job, "pull request merged");
}

/**
 * Catch-up when smee/webhooks were down: any `pr_ci` / `waiting_on_you` job whose GitHub PR is
 * already merged is marked merged. Called from the worker and when opening a job page.
 */
export async function reconcileOpenPullRequests(ctx: ControlContext): Promise<string[]> {
  const open = await ctx.db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ["pr_ci", "waiting_on_you"]));
  const done: string[] = [];
  for (const job of open) {
    const merged = await syncMergedPullRequest(ctx, job);
    if (merged) done.push(job.id);
  }
  return done;
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
    await markJobMerged(ctx, job, "pull request merged");
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
    await markJobMerged(ctx, job, "confidence gate passed", "auto-merged");
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
