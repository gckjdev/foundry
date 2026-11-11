import { type Job, jobs, type Runner, runners } from "@foundry/db";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  isRunnerStage,
  nextRunnerStage,
  RUNNING_STATUSES,
  STICKY_WINDOW_MS,
} from "@foundry/shared";
import { and, eq, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import type { ControlContext } from "./context";
import { recordEvents, transitionJob } from "./jobs";

/**
 * Claim commits the row before the runner adds it to its in-memory map. If that HTTP round-trip
 * fails, wait two heartbeats so a still-starting JobRunner is not stolen, then give the job back.
 */
export const DROPPED_JOB_GRACE_MS = 2 * HEARTBEAT_INTERVAL_MS;

/**
 * Re-queue jobs whose runner stopped heartbeating (lid closed, crash, network loss). The job
 * resumes at the stage after its last checkpoint; the lost runner keeps a sticky window so it can
 * continue its own session if it comes back in time, otherwise any runner resumes from the brief.
 */
export async function requeueLostJobs(ctx: ControlContext): Promise<string[]> {
  const cutoff = new Date(ctx.now().getTime() - HEARTBEAT_TIMEOUT_MS);
  const lost = await ctx.db
    .select({ job: jobs, runner: runners })
    .from(jobs)
    .leftJoin(runners, eq(runners.id, jobs.runnerId))
    .where(
      and(
        inArray(jobs.status, [...RUNNING_STATUSES]),
        or(isNull(jobs.runnerId), lt(runners.lastSeenAt, cutoff), isNull(runners.lastSeenAt)),
      ),
    );
  const requeued: string[] = [];
  for (const { job, runner } of lost) {
    if (
      await requeueHeldJob(
        ctx,
        job,
        `Runner ${runner?.name ?? "unknown"} went offline during ${job.status}`,
        `runner ${runner?.name ?? "unknown"} offline`,
      )
    ) {
      requeued.push(job.id);
    }
  }
  return requeued;
}

/**
 * Jobs this online runner still owns in the database but did not report in `runningJobIds`.
 * That happens when claim committed and then the HTTP response never reached JobRunner.
 */
export async function requeueDroppedJobs(
  ctx: ControlContext,
  runner: Runner,
  runningJobIds: string[],
): Promise<string[]> {
  const cutoff = new Date(ctx.now().getTime() - DROPPED_JOB_GRACE_MS);
  const filters = [
    eq(jobs.runnerId, runner.id),
    inArray(jobs.status, [...RUNNING_STATUSES]),
    or(isNull(jobs.claimedAt), lt(jobs.claimedAt, cutoff)),
  ];
  if (runningJobIds.length > 0) filters.push(notInArray(jobs.id, runningJobIds));
  const dropped = await ctx.db
    .select()
    .from(jobs)
    .where(and(...filters));
  const requeued: string[] = [];
  for (const job of dropped) {
    if (
      await requeueHeldJob(
        ctx,
        job,
        `Runner ${runner.name} is no longer running this job (still in ${job.status})`,
        `runner ${runner.name} dropped the job`,
      )
    ) {
      requeued.push(job.id);
    }
  }
  return requeued;
}

async function requeueHeldJob(
  ctx: ControlContext,
  job: Job,
  message: string,
  reason: string,
): Promise<boolean> {
  const last = job.lastCompletedStage;
  const after = last && isRunnerStage(last) ? nextRunnerStage(last) : null;
  const resumeStage = after && after !== "pr_ci" ? after : isRunnerStage(job.status) ? job.status : "triage";
  const moved = await transitionJob(ctx, job.id, "queued", {
    reason,
    from: [job.status as never],
    patch: {
      resumeStage,
      stickyRunnerId: job.runnerId,
      stickyUntil: new Date(ctx.now().getTime() + STICKY_WINDOW_MS),
    },
  });
  if (!moved) return false;
  await recordEvents(ctx, moved, [{ kind: "log", level: "warn", message }]);
  return true;
}
