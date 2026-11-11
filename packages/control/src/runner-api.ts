import { evidence, type Job, jobs, type Runner, repos } from "@foundry/db";
import {
  type ConfidenceRequest,
  type EvidenceRequest,
  type FoundryEvent,
  isRunnerStage,
  nextRunnerStage,
  type PrReviewRequest,
  RUNNING_STATUSES,
  STICKY_WINDOW_MS,
  type StageRequest,
} from "@foundry/shared";
import { eq } from "drizzle-orm";
import type { ControlContext } from "./context";
import {
  getJob,
  type JobPatch,
  listPendingInputs,
  recordEvents,
  takePendingInputs,
  transitionJob,
} from "./jobs";
import { evaluateJobGate } from "./merge-gate";
import { submitPrReview } from "./pr-review";
import { askQuestion } from "./questions";

export class ConflictError extends Error {}

/** The job must be held by this runner and still running; otherwise it was revoked. */
export async function ownedJob(ctx: ControlContext, runner: Runner, jobId: string): Promise<Job> {
  const job = await getJob(ctx, jobId);
  if (
    job.teamId !== runner.teamId ||
    job.runnerId !== runner.id ||
    !RUNNING_STATUSES.includes(job.status as never)
  ) {
    throw new ConflictError("job is not held by this runner");
  }
  return job;
}

export async function runnerEvents(ctx: ControlContext, runner: Runner, jobId: string, list: FoundryEvent[]) {
  const job = await ownedJob(ctx, runner, jobId);
  await recordEvents(ctx, job, list);
}

export async function runnerStage(ctx: ControlContext, runner: Runner, jobId: string, req: StageRequest) {
  const job = await ownedJob(ctx, runner, jobId);
  const patch: JobPatch = {};
  if (req.lastCompletedStage !== undefined) patch.lastCompletedStage = req.lastCompletedStage;
  if (req.loopCount !== undefined) patch.loopCount = req.loopCount;
  if (req.sessionId !== undefined) patch.harnessSessionId = req.sessionId;
  if (req.worktreePath !== undefined) patch.worktreePath = req.worktreePath;
  if (req.portBase !== undefined) patch.portBase = req.portBase;

  if (req.to === "queued") {
    // The runner is giving the job back (schedule pause, shutdown): resume where it stopped.
    const last = req.lastCompletedStage ?? job.lastCompletedStage;
    const lastStage = last && isRunnerStage(last) ? nextRunnerStage(last) : null;
    patch.resumeStage =
      lastStage && lastStage !== "pr_ci" ? lastStage : isRunnerStage(job.status) ? job.status : "triage";
    patch.stickyRunnerId = runner.id;
    patch.stickyUntil = new Date(ctx.now().getTime() + STICKY_WINDOW_MS);
  }
  if (req.to === "failed") patch.failureReason = req.reason ?? "failed";
  const moved = await transitionJob(ctx, job.id, req.to, {
    reason: req.reason,
    patch,
    from: [job.status as never],
  });
  if (moved)
    ctx.log.debug("job stage changed", {
      jobId: job.id,
      from: job.status,
      to: req.to,
      runner: runner.name,
    });
  if (moved && req.to === "failed") {
    await ctx.notifier.notify(ctx, { event: "failed", job: moved, detail: req.reason ?? "" });
  }
  return moved;
}

/** Report the automatic post-PR review. Approval re-runs the confidence gate immediately. */
export async function runnerPrReview(
  ctx: ControlContext,
  runner: Runner,
  jobId: string,
  req: PrReviewRequest,
) {
  const job = await ownedJob(ctx, runner, jobId);
  const updated = await submitPrReview(ctx, job, req);
  if (updated.status === "pr_ci") await evaluateJobGate(ctx, updated.id);
  return { status: updated.status };
}

export async function runnerAsk(
  ctx: ControlContext,
  runner: Runner,
  jobId: string,
  prompt: string,
  options: string[],
) {
  const job = await ownedJob(ctx, runner, jobId);
  return askQuestion(ctx, job, { prompt, options });
}

export async function runnerEvidence(
  ctx: ControlContext,
  runner: Runner,
  jobId: string,
  req: EvidenceRequest,
) {
  const job = await ownedJob(ctx, runner, jobId);
  const [row] = await ctx.db
    .insert(evidence)
    .values({
      jobId: job.id,
      kind: req.kind,
      name: req.name,
      status: req.status,
      command: req.command ?? null,
      exitCode: req.exitCode ?? null,
      outputTail: req.outputTail ?? null,
      durationMs: req.durationMs ?? null,
      artifactId: req.artifactId ?? null,
      loop: job.loopCount,
    })
    .returning();
  await recordEvents(ctx, job, [{ kind: "evidence", name: req.name, status: req.status }]);
  return row!;
}

export async function runnerConfidence(
  ctx: ControlContext,
  runner: Runner,
  jobId: string,
  req: ConfidenceRequest,
) {
  const job = await ownedJob(ctx, runner, jobId);
  await ctx.db.update(jobs).set({ confidence: req }).where(eq(jobs.id, job.id));
  await recordEvents(ctx, job, [
    {
      kind: "log",
      level: "info",
      message: `Confidence: ${req.level}${req.uncertainties.length ? ` (${req.uncertainties.length} uncertainties)` : ""}`,
    },
  ]);
}

export async function runnerPlan(ctx: ControlContext, runner: Runner, jobId: string, plan: string) {
  const job = await ownedJob(ctx, runner, jobId);
  await ctx.db.update(jobs).set({ plan }).where(eq(jobs.id, job.id));
  await recordEvents(ctx, job, [{ kind: "message", role: "agent", text: `Plan:\n${plan}` }]);
}

export async function runnerCheckpoint(
  ctx: ControlContext,
  runner: Runner,
  jobId: string,
  req: { stage: string | null; sessionId: string | null; briefRef: string; headSha: string | null },
) {
  const job = await ownedJob(ctx, runner, jobId);
  await ctx.db
    .update(jobs)
    .set({
      ...(req.stage ? { lastCompletedStage: req.stage } : {}),
      harnessSessionId: req.sessionId,
      briefRef: req.briefRef,
      ...(req.headSha ? { headSha: req.headSha } : {}),
    })
    .where(eq(jobs.id, job.id));
  await recordEvents(ctx, job, [{ kind: "checkpoint", stage: req.stage ?? "none", briefRef: req.briefRef }]);
}

export async function runnerInputs(ctx: ControlContext, runner: Runner, jobId: string, take: boolean) {
  await ownedJob(ctx, runner, jobId);
  if (take) return takePendingInputs(ctx, jobId);
  return listPendingInputs(ctx, jobId);
}

/** Short-lived installation token so the runner can fetch and push the job branch. */
export async function runnerGitToken(ctx: ControlContext, runner: Runner, repoId: string) {
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo || repo.teamId !== runner.teamId) throw new ConflictError("repo not in runner's team");
  return ctx.gh.installationToken(repo.ghInstallationId);
}
