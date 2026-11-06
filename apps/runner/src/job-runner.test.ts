import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHarness, type FakeTurn } from "@foundry/harness-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobRunner, type JobRunnerDeps } from "./job-runner";
import { PortLeases } from "./ports";
import { LocalJobs } from "./state";
import {
  agentTools,
  claimedJob,
  createGitFixture,
  gitIn,
  RecordingControlPlane,
  TEST_RECIPE,
  testSocketPath,
} from "./testing";
import { ToolServer } from "./tool-server";
import { Workspace } from "./workspace";

const fixture = createGitFixture();
let tools: ToolServer;
let api: RecordingControlPlane;
let dataDir: string;
let prevBase: string | undefined;

beforeAll(async () => {
  prevBase = process.env.FOUNDRY_GIT_BASE;
  process.env.FOUNDRY_GIT_BASE = fixture.base;
  fixture.seedRepo("acme/app", { ".foundry/recipe.yaml": TEST_RECIPE, "README.md": "# app\n" });
  fixture.seedRepo("acme/fresh", { "package.json": "{}\n" });
  tools = new ToolServer(testSocketPath());
  await tools.start();
});

afterAll(async () => {
  await tools.close();
  if (prevBase === undefined) delete process.env.FOUNDRY_GIT_BASE;
  else process.env.FOUNDRY_GIT_BASE = prevBase;
});

beforeEach(() => {
  api = new RecordingControlPlane();
  dataDir = mkdtempSync(join(tmpdir(), "foundry-runner-"));
});

afterEach(() => {});

function deps(harness: FakeHarness): JobRunnerDeps {
  return {
    api,
    harnesses: { [harness.id]: harness },
    workspace: new Workspace(dataDir),
    ports: new PortLeases(join(dataDir, "ports.json")),
    tools,
    localJobs: new LocalJobs(join(dataDir, "jobs")),
    mcpCommand: { command: "foundry", args: ["mcp"] },
    log: () => {},
    eventFlushMs: 50,
    askGraceMs: 200,
  };
}

/** A whole well-behaved agent turn: stages in order, writes the file, verifies, finishes. */
const happyTurn: FakeTurn = {
  events: [{ kind: "message", role: "agent", text: "Looking at the repo with token ghs_abcdefghijklmnopqrstuvwxyz123456" }],
  costUsd: 0.12,
  act: async ({ cwd, env }) => {
    const call = agentTools(env);
    await call("stage", { name: "investigating", summary: "Ticket is clear" });
    await call("plan", { plan: "1. write done.txt" });
    await call("stage", { name: "implementing", summary: "Need one file" });
    writeFileSync(join(cwd, "done.txt"), "done\n");
    await call("stage", { name: "verifying", summary: "Wrote done.txt" });
    const checks = await call("run_checks");
    expect(checks.text).toContain("All checks passed");
    await call("confidence", { level: "high", reasons: ["trivial"] });
    await call("stage", { name: "done", summary: "Adds done.txt" });
  },
};

describe("JobRunner", () => {
  it("drives a ticket through the stages to a pull request", async () => {
    const harness = new FakeHarness("claude-code", [happyTurn]);
    const job = claimedJob();
    const outcome = await new JobRunner(deps(harness), job).run();
    expect(outcome).toBe("pr_opened");

    expect(api.named("stage").map((c) => (c.body as { to: string }).to)).toEqual(["investigating", "implementing", "verifying"]);
    const pr = api.named("openPr")[0]!.body as { title: string; summary: string; changedLines: number; uiChanged: boolean };
    expect(pr).toMatchObject({ title: "Add done marker", summary: "Adds done.txt", changedLines: 1, uiChanged: false });
    // The agent's run_checks result at the same tree is reused: one check evidence, not two.
    expect(api.named("evidence")).toHaveLength(1);
    expect(api.named("checkpoint")).toHaveLength(3);

    const origin = join(fixture.root, "acme/app.git");
    expect(gitIn(origin, "show", `${job.branch}:done.txt`)).toBe("done");
    expect(gitIn(origin, "show", `refs/foundry/${job.id}/brief:brief.md`)).toContain("Stage reached: **implementing**");

    const events = api.named("events").flatMap((c) => c.body as { kind: string; text?: string }[]);
    const said = events.find((e) => e.kind === "message")!;
    expect(said.text).toContain("[redacted]");
    expect(events.some((e) => e.kind === "usage")).toBe(true);
    expect(existsSync(join(dataDir, "worktrees", job.id))).toBe(false);
  });

  it("sends failing checks back to the agent, then opens the PR once they pass", async () => {
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "ok" });
          await call("stage", { name: "implementing", summary: "ok" });
          await call("stage", { name: "verifying", summary: "forgot the file" });
          await call("stage", { name: "done", summary: "done (not really)" });
        },
      },
      {
        act: async ({ cwd, env, prompt }) => {
          expect(prompt).toContain("verify loop 1 of 3");
          writeFileSync(join(cwd, "done.txt"), "done\n");
          const call = agentTools(env);
          await call("stage", { name: "verifying", summary: "fixed" });
          await call("stage", { name: "done", summary: "Adds done.txt" });
        },
      },
    ]);
    const outcome = await new JobRunner(deps(harness), claimedJob({ id: "22222222-0000-0000-0000-000000000000", branch: "foundry/2" })).run();
    expect(outcome).toBe("pr_opened");
    const stages = api.named("stage").map((c) => c.body as { to: string; loopCount?: number });
    expect(stages.map((s) => s.to)).toEqual(["investigating", "implementing", "verifying", "implementing", "verifying"]);
    expect(stages[3]!.loopCount).toBe(1);
    const checks = api.named("evidence").map((c) => (c.body as { status: string }).status);
    expect(checks).toEqual(["failed", "passed"]);
    expect(harness.calls.map((c) => c.kind)).toEqual(["start", "resume"]);
  });

  it("rejects out-of-order stages", async () => {
    let reply = "";
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ env }) => {
          reply = (await agentTools(env)("stage", { name: "done", summary: "skip ahead" })).text;
        },
      },
    ]);
    const outcome = await new JobRunner({ ...deps(harness), maxNudges: 0 }, claimedJob({ id: "33333333-0000-0000-0000-000000000000", branch: "foundry/3" })).run();
    expect(reply).toContain("call stage(investigating) first");
    expect(outcome).toBe("failed");
    expect((api.named("stage").at(-1)!.body as { reason: string }).reason).toContain("stopped before finishing");
  });

  it("parks on a question, then resumes the same session in place with the answer", async () => {
    const job = claimedJob({ id: "44444444-0000-0000-0000-000000000000", branch: "foundry/4" });
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ env }) => {
          await agentTools(env)("ask", { question: "CSV or XLSX?", options: ["CSV", "XLSX"] });
        },
      },
      happyTurn,
    ]);
    const d = deps(harness);
    expect(await new JobRunner(d, job).run()).toBe("needs_input");
    expect(api.named("ask")[0]!.body).toEqual({ prompt: "CSV or XLSX?", options: ["CSV", "XLSX"] });
    expect((api.named("checkpoint")[0]!.body as { sessionId: string }).sessionId).toBe("fake-session-1");
    expect(d.localJobs.get(job.id)?.state).toBe("parked");
    expect(existsSync(join(dataDir, "worktrees", job.id))).toBe(true);

    const resumed = claimedJob({
      ...job,
      resumeMode: "sticky",
      sessionId: "fake-session-1",
      pendingInputs: [{ kind: "answer", text: "CSV", by: "alice", questionPrompt: "CSV or XLSX?" }],
    });
    expect(await new JobRunner(d, resumed).run()).toBe("pr_opened");
    const call = harness.calls[1]!;
    expect(call.kind).toBe("resume");
    expect(call.sessionId).toBe("fake-session-1");
    expect(call.prompt).toContain('@alice answered your question "CSV or XLSX?": CSV');
  });

  it("gives the job back when paused, and a portable resume starts from the brief", async () => {
    const job = claimedJob({ id: "55555555-0000-0000-0000-000000000000", branch: "foundry/5" });
    let release!: () => void;
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "clear" });
          await call("plan", { plan: "write done.txt" });
          writeFileSync(join(cwd, "done.txt"), "done\n");
          await call("stage", { name: "implementing", summary: "found the spot" });
          await new Promise<void>((r) => {
            release = r;
          });
        },
      },
    ]);
    const runner = new JobRunner(deps(harness), job);
    const running = runner.run();
    while (!release) await new Promise((r) => setTimeout(r, 20));
    await runner.pause();
    expect(await running).toBe("paused");
    const last = api.named("stage").at(-1)!.body as { to: string; lastCompletedStage: string };
    expect(last).toMatchObject({ to: "queued", lastCompletedStage: "investigating" });

    // Another machine (fresh data dir) picks it up from the brief.
    dataDir = mkdtempSync(join(tmpdir(), "foundry-runner-"));
    const other = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env, prompt }) => {
          expect(prompt).toContain("resuming from its last checkpoint");
          expect(prompt).toContain("write done.txt");
          expect(existsSync(join(cwd, "done.txt"))).toBe(true);
          const call = agentTools(env);
          await call("stage", { name: "verifying", summary: "done" });
          await call("stage", { name: "done", summary: "Adds done.txt" });
        },
      },
    ]);
    const portable = claimedJob({ ...job, resumeMode: "portable", resumeStage: "implementing" });
    expect(await new JobRunner(deps(other), portable).run()).toBe("pr_opened");
  });

  it("fails a job that exceeds the cost budget", async () => {
    const harness = new FakeHarness("claude-code", [
      { events: [{ kind: "usage", tokensIn: 1, tokensOut: 1, costUsd: 9 }], act: () => new Promise((r) => setTimeout(r, 5_000)) },
    ]);
    const outcome = await new JobRunner(deps(harness), claimedJob({ id: "66666666-0000-0000-0000-000000000000", branch: "foundry/6" })).run();
    expect(outcome).toBe("failed");
    expect((api.named("stage").at(-1)!.body as { reason: string }).reason).toContain("max_cost_per_job_usd");
  });

  it("onboards a repo: the agent writes the recipe, the runner proves it and reports", async () => {
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "node repo" });
          await call("stage", { name: "implementing", summary: "commands found" });
          const { mkdirSync } = await import("node:fs");
          mkdirSync(join(cwd, ".foundry"), { recursive: true });
          writeFileSync(join(cwd, ".foundry/recipe.yaml"), "checks:\n  - name: json\n    run: test -f package.json\n");
          writeFileSync(join(cwd, ".foundry/policy.yaml"), "merge: off\n");
          await call("stage", { name: "verifying", summary: "files written" });
          await call("stage", { name: "done", summary: "Recipe runs one check" });
        },
      },
    ]);
    const job = claimedJob({
      id: "77777777-0000-0000-0000-000000000000",
      kind: "onboarding",
      playbook: "onboarding",
      repo: { id: "repo-2", fullName: "acme/fresh", defaultBranch: "main" },
      branch: "foundry/onboarding-77777777",
      issueNumber: null,
    });
    expect(await new JobRunner(deps(harness), job).run()).toBe("onboarded");
    const result = api.named("onboarding")[0]!.body as { ok: boolean; headSha: string };
    expect(result.ok).toBe(true);
    expect(gitIn(join(fixture.root, "acme/fresh.git"), "show", `${job.branch}:.foundry/recipe.yaml`)).toContain("test -f package.json");
  });
});
