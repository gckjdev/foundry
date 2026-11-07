import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectGarbage } from "./gc";
import { PortLeases } from "./ports";
import { LocalJobs } from "./state";
import { Workspace } from "./workspace";

const DAY = 24 * 3600_000;

function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), "foundry-gc-"));
  return {
    workspace: new Workspace(root),
    localJobs: new LocalJobs(join(root, "jobs")),
    ports: new PortLeases(join(root, "ports.json")),
  };
}

function park(localJobs: LocalJobs, jobId: string) {
  localJobs.put({
    jobId,
    repoFullName: "acme/app",
    worktree: join("/nonexistent", jobId),
    sessionId: null,
    portBase: null,
    state: "parked",
  });
}

describe("collectGarbage", () => {
  it("removes a parked job older than 7 days even when keep is null", async () => {
    const env = makeEnv();
    park(env.localJobs, "job-old");
    const removed = await collectGarbage({
      ...env,
      running: new Set(),
      keep: null,
      now: Date.now() + 8 * DAY,
    });
    expect(removed).toEqual(["job-old"]);
    expect(env.localJobs.get("job-old")).toBeNull();
  });

  it("keeps a parked job 1 day old", async () => {
    const env = makeEnv();
    park(env.localJobs, "job-fresh");
    const removed = await collectGarbage({
      ...env,
      running: new Set(),
      keep: null,
      now: Date.now() + 1 * DAY,
    });
    expect(removed).toEqual([]);
    expect(env.localJobs.get("job-fresh")).not.toBeNull();
  });

  it("removes a job not in keep", async () => {
    const env = makeEnv();
    park(env.localJobs, "job-unwanted");
    const removed = await collectGarbage({
      ...env,
      running: new Set(),
      keep: new Set(["job-elsewhere"]),
      now: Date.now(),
    });
    expect(removed).toEqual(["job-unwanted"]);
    expect(env.localJobs.get("job-unwanted")).toBeNull();
  });

  it("keeps a job in keep", async () => {
    const env = makeEnv();
    park(env.localJobs, "job-kept");
    const removed = await collectGarbage({
      ...env,
      running: new Set(),
      keep: new Set(["job-kept"]),
      now: Date.now(),
    });
    expect(removed).toEqual([]);
    expect(env.localJobs.get("job-kept")).not.toBeNull();
  });

  it("never removes running job ids", async () => {
    const env = makeEnv();
    park(env.localJobs, "job-running");
    const removed = await collectGarbage({
      ...env,
      running: new Set(["job-running"]),
      keep: new Set(),
      now: Date.now() + 30 * DAY,
    });
    expect(removed).toEqual([]);
    expect(env.localJobs.get("job-running")).not.toBeNull();
  });
});
