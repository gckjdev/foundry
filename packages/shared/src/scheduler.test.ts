import { describe, expect, it } from "vitest";
import { LAPTOP_DEFAULT_SCHEDULE, rankRunners, type SchedJob, type SchedRunner, scheduleAllows } from "./scheduler";

const now = new Date("2026-11-06T10:00:00");
const runner = (over: Partial<SchedRunner>): SchedRunner => ({
  id: over.name ?? "r",
  name: "r",
  kind: "personal",
  os: "macos",
  ownerUserId: null,
  lastSeenAt: new Date(now.getTime() - 5_000),
  accepting: true,
  draining: false,
  running: 0,
  maxConcurrency: 2,
  readyRepoIds: ["repo"],
  harnesses: ["claude-code", "opencode"],
  ...over,
});
const job = (over: Partial<SchedJob> = {}): SchedJob => ({
  id: "j",
  repoId: "repo",
  harness: "claude-code",
  pinnedRunnerName: null,
  stickyRunnerId: null,
  stickyUntil: null,
  authorUserId: "alice",
  allowedOs: null,
  ...over,
});

describe("rankRunners", () => {
  it("prefers shared, then least loaded, then the author's laptop", () => {
    const rs = [
      runner({ name: "bob-laptop", ownerUserId: "bob" }),
      runner({ name: "alice-laptop", ownerUserId: "alice" }),
      runner({ name: "busy", running: 1 }),
      runner({ name: "mini", kind: "shared", maxConcurrency: 6, running: 3 }),
    ];
    expect(rankRunners(job(), rs, now).map((r) => r.name)).toEqual(["mini", "alice-laptop", "bob-laptop", "busy"]);
  });

  it("filters by readiness, harness, os, pin and liveness", () => {
    const rs = [
      runner({ name: "offline", lastSeenAt: new Date(now.getTime() - 300_000) }),
      runner({ name: "no-repo", readyRepoIds: [] }),
      runner({ name: "no-opencode", harnesses: ["claude-code"] }),
      runner({ name: "linux", os: "linux", harnesses: ["opencode"] }),
      runner({ name: "full", running: 2 }),
      runner({ name: "battery", accepting: false }),
    ];
    expect(rankRunners(job({ harness: "opencode" }), rs, now).map((r) => r.name)).toEqual(["linux"]);
    expect(rankRunners(job({ harness: "opencode", allowedOs: ["macos"] }), rs, now)).toEqual([]);
    expect(rankRunners(job({ pinnedRunnerName: "linux", harness: "opencode" }), rs, now)[0]?.name).toBe("linux");
  });

  it("reserves a job for its sticky runner while that runner is online", () => {
    const rs = [runner({ name: "a" }), runner({ name: "b", kind: "shared" })];
    const sticky = job({ stickyRunnerId: "a", stickyUntil: new Date(now.getTime() + 60_000) });
    expect(rankRunners(sticky, rs, now).map((r) => r.name)).toEqual(["a"]);
    const offline = [runner({ name: "a", lastSeenAt: null }), runner({ name: "b", kind: "shared" })];
    expect(rankRunners(sticky, offline, now).map((r) => r.name)).toEqual(["b"]);
    const expired = job({ stickyRunnerId: "a", stickyUntil: new Date(now.getTime() - 1) });
    expect(rankRunners(expired, rs, now)[0]?.name).toBe("b");
  });
});

describe("scheduleAllows", () => {
  it("respects AC power, idle and windows", () => {
    expect(scheduleAllows(LAPTOP_DEFAULT_SCHEDULE, { onAcPower: false, idleSeconds: 0 }, now).ok).toBe(false);
    expect(scheduleAllows(LAPTOP_DEFAULT_SCHEDULE, { onAcPower: true, idleSeconds: 0 }, now).ok).toBe(true);
    const nights = { ...LAPTOP_DEFAULT_SCHEDULE, windows: ["19:00-07:00"], weekends: false };
    expect(scheduleAllows(nights, { onAcPower: true, idleSeconds: 0 }, now).ok).toBe(false);
    expect(scheduleAllows(nights, { onAcPower: true, idleSeconds: 0 }, new Date("2026-11-06T23:30:00")).ok).toBe(
      true,
    );
    const active = { ...LAPTOP_DEFAULT_SCHEDULE, pauseWhenActiveMinutes: 10 };
    expect(scheduleAllows(active, { onAcPower: true, idleSeconds: 30 }, now).reason).toBe("owner is active");
  });
});
