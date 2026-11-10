import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHarness } from "@foundry/harness-core";
import type { OsAdapter } from "@foundry/os-adapters";
import { LAPTOP_DEFAULT_SCHEDULE, noopLogger, parseRecipeYaml } from "@foundry/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyScheduleArgs } from "./config";
import { Daemon } from "./daemon";
import { checkRecipe, depBinary } from "./readiness";
import { scrub } from "./scrub";
import {
  agentTools,
  claimedJob,
  createGitFixture,
  RecordingControlPlane,
  TEST_RECIPE,
  testSocketPath,
} from "./testing";

const fixture = createGitFixture();
let prevBase: string | undefined;

beforeAll(() => {
  prevBase = process.env.FOUNDRY_GIT_BASE;
  process.env.FOUNDRY_GIT_BASE = fixture.base;
  fixture.seedRepo("acme/app", { ".foundry/recipe.yaml": TEST_RECIPE });
});
afterAll(() => {
  if (prevBase === undefined) delete process.env.FOUNDRY_GIT_BASE;
  else process.env.FOUNDRY_GIT_BASE = prevBase;
});

function fakeOs(power: { ac: boolean | null }): OsAdapter & { inhibits: number; releases: number } {
  const os = {
    os: "macos" as const,
    inhibits: 0,
    releases: 0,
    info: async () => ({ os: "macos" as const, osVersion: "15.0", arch: "arm64", cpu: 8, memMb: 16_000 }),
    diskFreeMb: async () => 50_000,
    onAcPower: async () => power.ac,
    idleSeconds: async () => null,
    inhibitSleep: async () => {
      os.inhibits++;
      return { release: () => void os.releases++ };
    },
    service: () => ({ path: "", contents: "", activate: [], deactivate: [] }),
    createUserCommands: () => [],
    secrets: async () => {
      throw new Error("unused");
    },
    wrapWithLimits: async (argv: string[]) => argv,
  };
  return os;
}

const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("Daemon", () => {
  it("claims a job, keeps the machine awake while it runs, and reports it in heartbeats", async () => {
    const api = new RecordingControlPlane();
    api.claimQueue.push(claimedJob({ id: "aaaaaaaa-0000-0000-0000-000000000000", branch: "foundry/a" }));
    let release!: () => void;
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          await new Promise<void>((r) => {
            release = r;
          });
          const call = agentTools(env);
          for (const name of ["investigating", "implementing"]) await call("stage", { name, summary: "ok" });
          writeFileSync(join(cwd, "done.txt"), "x\n");
          await call("stage", { name: "verifying", summary: "ok" });
          await call("stage", { name: "done", summary: "done" });
        },
      },
    ]);
    const os = fakeOs({ ac: true });
    const daemon = new Daemon({
      api,
      os,
      harnesses: { "claude-code": harness },
      dataDir: mkdtempSync(join(tmpdir(), "foundry-daemon-")),
      maxConcurrency: 1,
      schedule: LAPTOP_DEFAULT_SCHEDULE,
      minFreeDiskMb: 1_000,
      mcpCommand: { command: "foundry", args: ["mcp"] },
      socketPath: testSocketPath(),
      heartbeatMs: 60_000,
      logger: noopLogger,
    });
    await daemon.start();
    await until(() => daemon.running.size === 1 && !!release);
    await until(() => os.inhibits === 1);
    await daemon.tick();
    const hb = api.named("heartbeat").at(-1)!.body as { runningJobIds: string[]; accepting: boolean };
    expect(hb).toMatchObject({ runningJobIds: ["aaaaaaaa-0000-0000-0000-000000000000"], accepting: true });
    release();
    await until(() => daemon.running.size === 0);
    expect(api.named("openPr")).toHaveLength(1);
    expect(os.releases).toBe(1);
    await daemon.stop();
  });

  it("stops taking jobs on battery and stops a job the control plane revoked", async () => {
    const api = new RecordingControlPlane();
    const power = { ac: true as boolean | null };
    api.claimQueue.push(claimedJob({ id: "bbbbbbbb-0000-0000-0000-000000000000", branch: "foundry/b" }));
    const harness = new FakeHarness("claude-code", [{ act: () => new Promise(() => {}) }]);
    const daemon = new Daemon({
      api,
      os: fakeOs(power),
      harnesses: { "claude-code": harness },
      dataDir: mkdtempSync(join(tmpdir(), "foundry-daemon-")),
      maxConcurrency: 2,
      schedule: LAPTOP_DEFAULT_SCHEDULE,
      minFreeDiskMb: 1_000,
      mcpCommand: { command: "foundry", args: ["mcp"] },
      socketPath: testSocketPath(),
      heartbeatMs: 60_000,
      logger: noopLogger,
    });
    await daemon.start();
    await until(() => daemon.running.size === 1);
    api.heartbeatResponse = {
      ...api.heartbeatResponse,
      revokedJobIds: ["bbbbbbbb-0000-0000-0000-000000000000"],
    };
    power.ac = false;
    api.claimQueue.push(claimedJob({ id: "cccccccc-0000-0000-0000-000000000000" }));
    await daemon.tick();
    await until(() => daemon.running.size === 0);
    const hb = api.named("heartbeat").at(-1)!.body as { accepting: boolean; notAcceptingReason: string };
    expect(hb).toMatchObject({ accepting: false, notAcceptingReason: "on battery" });
    expect(api.claimQueue).toHaveLength(1);
    // A revoked job is not reported as failed or queued: the control plane already moved it.
    expect(api.named("stage").filter((c) => c.jobId === "bbbbbbbb-0000-0000-0000-000000000000")).toHaveLength(
      0,
    );
    await daemon.stop();
  });
});

describe("runner helpers", () => {
  it("checks recipe readiness against OS and system deps", async () => {
    const recipe = parseRecipeYaml(
      "system_deps: [node>=20, pnpm]\nos: [linux]\nchecks: [{name: t, run: 'true'}]",
    );
    expect(depBinary("node>=20")).toBe("node");
    expect(await checkRecipe(recipe, "macos", { which: async () => true })).toEqual({
      ready: false,
      reason: "recipe is limited to linux",
    });
    expect(await checkRecipe(recipe, "linux", { which: async (b) => b === "node" })).toEqual({
      ready: false,
      reason: "missing: pnpm",
    });
    expect((await checkRecipe(recipe, "linux", { which: async () => true })).ready).toBe(true);
  });

  it("scrubs secrets from text", () => {
    expect(scrub("token ghs_0123456789abcdefghijABCDEFGHIJ ok")).toBe("token [redacted] ok");
    expect(scrub("Authorization: Bearer abc.def")).toBe("Authorization: Bearer [redacted]");
    expect(scrub("pw=hunter2hunter2", ["hunter2hunter2"])).toBe("pw=[redacted]");
  });

  it("parses schedule flags", () => {
    const s = applyScheduleArgs(LAPTOP_DEFAULT_SCHEDULE, {
      window: ["19:00-08:00"],
      "pause-when-active": "10",
      "ac-only": "false",
    });
    expect(s).toEqual({
      acPowerOnly: false,
      pauseWhenActiveMinutes: 10,
      windows: ["19:00-08:00"],
      weekends: true,
    });
  });
});
