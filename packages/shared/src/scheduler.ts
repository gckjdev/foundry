import type { Os } from "./recipe";

export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A runner that misses heartbeats this long is offline; its active jobs are re-queued. */
export const HEARTBEAT_TIMEOUT_MS = 120_000;
/** How long a resumable job is reserved for the runner that holds its session. */
export const STICKY_WINDOW_MS = 10 * 60_000;

export interface SchedRunner {
  id: string;
  name: string;
  kind: "shared" | "personal";
  os: Os;
  ownerUserId: string | null;
  lastSeenAt: Date | null;
  /** Reported by the runner from its own schedule, power and idle state. */
  accepting: boolean;
  draining: boolean;
  running: number;
  maxConcurrency: number;
  readyRepoIds: string[];
  harnesses: string[];
}

export interface SchedJob {
  id: string;
  repoId: string;
  harness: string;
  pinnedRunnerName: string | null;
  stickyRunnerId: string | null;
  stickyUntil: Date | null;
  authorUserId: string | null;
  allowedOs: Os[] | null;
}

export function isOnline(r: Pick<SchedRunner, "lastSeenAt">, now: Date): boolean {
  return !!r.lastSeenAt && now.getTime() - r.lastSeenAt.getTime() < HEARTBEAT_TIMEOUT_MS;
}

export type Ineligibility =
  | "offline"
  | "not_accepting"
  | "draining"
  | "full"
  | "repo_not_ready"
  | "harness_missing"
  | "os_mismatch"
  | "pinned_elsewhere";

export function ineligibility(job: SchedJob, r: SchedRunner, now: Date): Ineligibility | null {
  if (!isOnline(r, now)) return "offline";
  if (r.draining) return "draining";
  if (!r.accepting) return "not_accepting";
  if (r.running >= r.maxConcurrency) return "full";
  if (job.pinnedRunnerName && job.pinnedRunnerName !== r.name) return "pinned_elsewhere";
  if (!r.readyRepoIds.includes(job.repoId)) return "repo_not_ready";
  if (!r.harnesses.includes(job.harness)) return "harness_missing";
  if (job.allowedOs && !job.allowedOs.includes(r.os)) return "os_mismatch";
  return null;
}

/**
 * Runners that may take the job, best first (spec 5.9): pin, then the sticky runner during its
 * window, then shared runners, then the least-loaded personal runner, with a tie-break bonus for
 * the author's own laptop.
 */
export function rankRunners(job: SchedJob, runners: SchedRunner[], now: Date): SchedRunner[] {
  if (job.stickyRunnerId && job.stickyUntil && job.stickyUntil > now) {
    const sticky = runners.find((r) => r.id === job.stickyRunnerId);
    if (sticky && isOnline(sticky, now)) {
      return ineligibility(job, sticky, now) === null ? [sticky] : [];
    }
  }
  return runners
    .filter((r) => ineligibility(job, r, now) === null)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "shared" ? -1 : 1;
      const load = a.running / a.maxConcurrency - b.running / b.maxConcurrency;
      if (load !== 0) return load;
      const aAuthor = a.ownerUserId !== null && a.ownerUserId === job.authorUserId;
      const bAuthor = b.ownerUserId !== null && b.ownerUserId === job.authorUserId;
      if (aAuthor !== bAuthor) return aAuthor ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function shouldClaim(job: SchedJob, runnerId: string, runners: SchedRunner[], now: Date): boolean {
  return rankRunners(job, runners, now)[0]?.id === runnerId;
}

export interface LocalSchedule {
  /** Only take jobs on AC power (laptops default true). */
  acPowerOnly: boolean;
  /** Pause while the owner is using the machine; minutes of input idle required. 0 = off. */
  pauseWhenActiveMinutes: number;
  /** Optional allowed windows, local time "HH:MM-HH:MM"; empty = any time. */
  windows: string[];
  /** Also allow all day on Saturday and Sunday when windows are set. */
  weekends: boolean;
}

export const LAPTOP_DEFAULT_SCHEDULE: LocalSchedule = {
  acPowerOnly: true,
  pauseWhenActiveMinutes: 0,
  windows: [],
  weekends: true,
};

export const SHARED_DEFAULT_SCHEDULE: LocalSchedule = {
  acPowerOnly: false,
  pauseWhenActiveMinutes: 0,
  windows: [],
  weekends: true,
};

function inWindow(window: string, now: Date): boolean {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(window.trim());
  if (!m) return false;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const t = now.getHours() * 60 + now.getMinutes();
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

/** Whether the local schedule allows new jobs right now. */
export function scheduleAllows(
  s: LocalSchedule,
  state: { onAcPower: boolean | null; idleSeconds: number | null },
  now: Date,
): { ok: boolean; reason?: string } {
  if (s.acPowerOnly && state.onAcPower === false) return { ok: false, reason: "on battery" };
  if (s.pauseWhenActiveMinutes > 0 && state.idleSeconds !== null) {
    if (state.idleSeconds < s.pauseWhenActiveMinutes * 60) return { ok: false, reason: "owner is active" };
  }
  if (s.windows.length > 0) {
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    if (!(s.weekends && weekend) && !s.windows.some((w) => inWindow(w, now))) {
      return { ok: false, reason: "outside schedule window" };
    }
  }
  return { ok: true };
}
