import { jobs, runners } from "@foundry/db";
import {
  HEARTBEAT_TIMEOUT_MS,
  isRunnerStage,
  nextRunnerStage,
  RUNNING_STATUSES,
  STICKY_WINDOW_MS,
} from "@foundry/shared";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { ControlContext } from "./context";
import { recordEvents, transitionJob } from "./jobs";

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
    const last = job.lastCompletedStage;
    const after = last && isRunnerStage(last) ? nextRunnerStage(last) : null;
    const resumeStage =
      after && after !== "pr_ci" ? after : isRunnerStage(job.status) ? job.status : "triage";
    await recordEvents(ctx, job, [
      {
        kind: "log",
        level: "warn",
        message: `Runner ${runner?.name ?? "unknown"} went offline during ${job.status}`,
      },
    ]);
    const moved = await transitionJob(ctx, job.id, "queued", {
      reason: `runner ${runner?.name ?? "unknown"} offline`,
      from: [job.status as never],
      patch: {
        resumeStage,
        stickyRunnerId: job.runnerId,
        stickyUntil: new Date(ctx.now().getTime() + STICKY_WINDOW_MS),
      },
    });
    if (moved) requeued.push(job.id);
  }
  return requeued;
}
