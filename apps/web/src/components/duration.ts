import { type JobStatus, TERMINAL_STATUSES } from "@foundry/shared";

/** Statuses whose `finishedAt` is the end of the job's wall-clock time. `failed` is not terminal
 * in the state machine (it can be retried) but the attempt did stop. */
function isStopped(status: string): boolean {
  return status === "failed" || TERMINAL_STATUSES.includes(status as JobStatus);
}

/**
 * Human-readable wall-clock duration between two instants. `end` of null means "still running",
 * i.e. measure up to now. Returns an em dash when the job has not started yet.
 */
export function elapsed(start: Date | string | null, end: Date | string | null): string {
  if (!start) return "—";
  const seconds = Math.max(0, Math.floor((endMs(end) - new Date(start).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}

/**
 * Total execution time for a job: from the first runner claim until it stopped, or until now
 * while it is still in flight. A job that was retried and is running again keeps counting from
 * its first claim rather than from the retry.
 */
export function jobElapsed(job: {
  status: string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  updatedAt: Date | string;
}): string {
  // A retried job keeps the `finishedAt` of its previous attempt, so only trust it once the job
  // has stopped again; `updatedAt` is the best fallback for rows that never got a `finishedAt`.
  const end = isStopped(job.status) ? (job.finishedAt ?? job.updatedAt) : null;
  return elapsed(job.startedAt, end);
}

function endMs(end: Date | string | null): number {
  return end ? new Date(end).getTime() : Date.now();
}
