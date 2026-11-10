import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AsyncQueue,
  FakeHarness,
  type FakeTurn,
  type HarnessAdapter,
  type HarnessEvent,
  type HarnessSession,
  type SessionResult,
} from "@foundry/harness-core";
import { noopLogger } from "@foundry/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const UI_RECIPE = `checks:
  - name: marker
    run: test -f done.txt
dev_server:
  run: |
    node -e 'require("node:http").createServer((req, res) => { res.statusCode = 200; res.end("ok"); }).listen(Number(process.env.FOUNDRY_PORT), "127.0.0.1")'
  ready_path: /
  timeout_sec: 30
ui_paths: ["**/*.tsx"]
`;

/** A 1x1 transparent PNG: enough for the evidence path, which only checks the file type. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const fixture = createGitFixture();
let tools: ToolServer;
let api: RecordingControlPlane;
let dataDir: string;
let prevBase: string | undefined;

beforeAll(async () => {
  prevBase = process.env.FOUNDRY_GIT_BASE;
  process.env.FOUNDRY_GIT_BASE = fixture.base;
  fixture.seedRepo("acme/app", { ".foundry/recipe.yaml": TEST_RECIPE, "README.md": "# app\n" });
  fixture.seedRepo("acme/ui", { ".foundry/recipe.yaml": UI_RECIPE, "README.md": "# ui\n" });
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

afterEach(() => {
  vi.unstubAllGlobals();
});

function deps(
  harness: HarnessAdapter,
  screenshot?: (url: string, path: string) => Promise<void>,
): JobRunnerDeps {
  return {
    api,
    harnesses: { [harness.id]: harness },
    workspace: new Workspace(dataDir),
    ports: new PortLeases(join(dataDir, "ports.json")),
    tools,
    localJobs: new LocalJobs(join(dataDir, "jobs")),
    mcpCommand: { command: "foundry", args: ["mcp"] },
    logger: noopLogger,
    eventFlushMs: 50,
    askGraceMs: 200,
    screenshot,
  };
}

/** A well-behaved implementation turn: stages through reviewing, then the runner reviews. */
const implementTurn: FakeTurn = {
  events: [
    {
      kind: "message",
      role: "agent",
      text: "Looking at the repo with token ghs_abcdefghijklmnopqrstuvwxyz123456",
    },
  ],
  costUsd: 0.12,
  act: async ({ cwd, env }) => {
    const call = agentTools(env);
    await call("stage", { name: "investigating", summary: "Ticket is clear" });
    await call("plan", { plan: "1. write done.txt" });
    await call("stage", { name: "implementing", summary: "Need one file" });
    writeFileSync(join(cwd, "done.txt"), "done\n");
    await call("stage", { name: "reviewing", summary: "Wrote done.txt" });
  },
};

/** The independent reviewer's own turn: report a verdict through its dedicated MCP registration. */
const approveReview: FakeTurn = {
  costUsd: 0.03,
  act: async ({ cwd, env }) => {
    // It sees a clean checkout with the base branch available for the diff.
    expect(gitIn(cwd, "status", "--porcelain")).toBe("");
    expect(gitIn(cwd, "rev-parse", "--verify", "origin/main")).toBeTruthy();
    const reply = await agentTools(env)("review", {
      verdict: "approve",
      summary: "No blocking issues",
      findings: [],
    });
    expect(reply.isError).toBeFalsy();
  },
};

/** The implementer's resumed turn after the reviewer approves: verify and finish. */
function finishTurn(summary = "Adds done.txt"): FakeTurn {
  return {
    act: async ({ env }) => {
      const call = agentTools(env);
      await call("stage", { name: "verifying", summary });
      const checks = await call("run_checks");
      expect(checks.text).toContain("All checks passed");
      await call("confidence", { level: "high", reasons: ["trivial"] });
      await call("stage", { name: "done", summary });
    },
  };
}

const happyTurns = (): FakeTurn[] => [implementTurn, approveReview, finishTurn()];

describe("JobRunner", () => {
  it("drives a ticket through the stages to a pull request", async () => {
    const harness = new FakeHarness("claude-code", happyTurns());
    const job = claimedJob();
    const outcome = await new JobRunner(deps(harness), job).run();
    expect(outcome).toBe("pr_opened");

    expect(api.named("stage").map((c) => (c.body as { to: string }).to)).toEqual([
      "investigating",
      "implementing",
      "reviewing",
      "verifying",
    ]);
    const pr = api.named("openPr")[0]!.body as {
      title: string;
      summary: string;
      changedLines: number;
      uiChanged: boolean;
    };
    expect(pr).toMatchObject({
      title: "Add done marker",
      summary: "Adds done.txt",
      changedLines: 1,
      uiChanged: false,
    });
    // The agent's run_checks result at the same tree is reused: one check evidence, not two,
    // plus the reviewer's verdict note.
    const evidence = api
      .named("evidence")
      .map((c) => c.body as { kind: string; name: string; status: string });
    expect(evidence.filter((e) => e.kind === "check")).toHaveLength(1);
    expect(evidence.find((e) => e.kind === "review")).toMatchObject({
      name: "code review",
      status: "passed",
    });
    expect(api.named("checkpoint")).toHaveLength(4);
    // The reviewer ran in a throwaway detached worktree, not the job's.
    expect(harness.calls[1]!.opts.cwd).not.toBe(join(dataDir, "worktrees", job.id));
    expect(harness.calls[1]!.opts.permissions.allowEdits).toBe(false);
    expect(existsSync(join(dataDir, "worktrees", `${job.id}-review`))).toBe(false);

    const origin = join(fixture.root, "acme/app.git");
    expect(gitIn(origin, "show", `${job.branch}:done.txt`)).toBe("done");
    expect(gitIn(origin, "show", `refs/foundry/${job.id}/brief:brief.md`)).toContain(
      "Stage reached: **reviewing**",
    );

    const events = api.named("events").flatMap((c) => c.body as { kind: string; text?: string }[]);
    const said = events.find((e) => e.kind === "message")!;
    expect(said.text).toContain("[redacted]");
    expect(events.some((e) => e.kind === "usage")).toBe(true);
    expect(existsSync(join(dataDir, "worktrees", job.id))).toBe(false);
  });

  it("downloads images attached to a human message into the worktree", async () => {
    const job = claimedJob({ id: "77777777-0000-0000-0000-000000000000", branch: "foundry/7" });
    const attachment = {
      artifactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      name: "bug shot.png",
      contentType: "image/png",
      url: "https://foundry.test/api/artifacts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?t=x",
    };
    let materializedDuringTurn = false;
    const turn: FakeTurn = {
      ...implementTurn,
      act: async (args) => {
        materializedDuringTurn = existsSync(
          join(args.cwd, ".foundry-local", "attachments", "aaaaaaaa-bug_shot.png"),
        );
        await implementTurn.act!(args);
      },
    };
    const harness = new FakeHarness("claude-code", [turn, approveReview, finishTurn()]);
    const fetchMock = vi.fn(async () => new Response(TINY_PNG));
    vi.stubGlobal("fetch", fetchMock);
    const resumed = claimedJob({
      ...job,
      resumeMode: "sticky",
      sessionId: "fake-session-1",
      pendingInputs: [
        { kind: "message", text: "This is what I meant", by: "alice", attachments: [attachment] },
      ],
    });

    expect(await new JobRunner(deps(harness), resumed).run()).toBe("pr_opened");
    expect(fetchMock).toHaveBeenCalledWith(attachment.url, expect.anything());
    const prompt = harness.calls[0]!.prompt;
    expect(prompt).toContain("This is what I meant");
    expect(prompt).toContain("aaaaaaaa-bug_shot.png");
    expect(materializedDuringTurn).toBe(true);
  });

  it("sends failing checks back to implementing, re-reviews, then opens the PR once they pass", async () => {
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "ok" });
          await call("stage", { name: "implementing", summary: "ok" });
          await call("stage", { name: "reviewing", summary: "forgot the file" });
        },
      },
      approveReview,
      {
        act: async ({ env }) => {
          const call = agentTools(env);
          await call("stage", { name: "verifying", summary: "forgot the file" });
          await call("stage", { name: "done", summary: "done (not really)" });
        },
      },
      {
        act: async ({ cwd, env, prompt }) => {
          expect(prompt).toContain("verify loop 1 of 3");
          writeFileSync(join(cwd, "done.txt"), "done\n");
          const call = agentTools(env);
          await call("stage", { name: "reviewing", summary: "fixed" });
        },
      },
      approveReview,
      finishTurn(),
    ]);
    const outcome = await new JobRunner(
      deps(harness),
      claimedJob({ id: "22222222-0000-0000-0000-000000000000", branch: "foundry/2" }),
    ).run();
    expect(outcome).toBe("pr_opened");
    const stages = api.named("stage").map((c) => c.body as { to: string; loopCount?: number });
    expect(stages.map((s) => s.to)).toEqual([
      "investigating",
      "implementing",
      "reviewing",
      "verifying",
      "implementing",
      "reviewing",
      "verifying",
    ]);
    expect(stages[4]!.loopCount).toBe(1);
    const evidence = api.named("evidence").map((c) => c.body as { kind: string; status: string });
    expect(evidence.filter((e) => e.kind === "check").map((e) => e.status)).toEqual(["failed", "passed"]);
    expect(evidence.filter((e) => e.kind === "review").map((e) => e.status)).toEqual(["passed", "passed"]);
  });

  it("fails the job instead of opening a PR when checks still fail after max verify loops", async () => {
    const implementTurn = (first: boolean): FakeTurn => ({
      act: async ({ env }) => {
        const call = agentTools(env);
        if (first) {
          await call("stage", { name: "investigating", summary: "ok" });
          await call("stage", { name: "implementing", summary: "ok" });
        }
        await call("stage", { name: "reviewing", summary: "still broken" });
      },
    });
    const verifyTurn: FakeTurn = {
      act: async ({ env }) => {
        const call = agentTools(env);
        await call("stage", { name: "verifying", summary: "still broken" });
        await call("stage", { name: "done", summary: "done (not really)" });
      },
    };
    // Default max_verify_loops is 3: the first verify plus three retries all fail, and each
    // retry is reviewed again before it can verify.
    const harness = new FakeHarness("claude-code", [
      implementTurn(true),
      approveReview,
      verifyTurn,
      implementTurn(false),
      approveReview,
      verifyTurn,
      implementTurn(false),
      approveReview,
      verifyTurn,
      implementTurn(false),
      approveReview,
      verifyTurn,
    ]);
    const outcome = await new JobRunner(
      deps(harness),
      claimedJob({ id: "88888888-0000-0000-0000-000000000000", branch: "foundry/8" }),
    ).run();
    expect(outcome).toBe("failed");
    expect(api.named("openPr")).toHaveLength(0);
    const last = api.named("stage").at(-1)!.body as { to: string; reason: string };
    expect(last.to).toBe("failed");
    expect(last.reason).toContain("marker");
    expect(last.reason).toContain("3 verify loops");
  });

  it("sends blocking review findings back to implementing and re-reviews the fix", async () => {
    let resumePrompt = "";
    const harness = new FakeHarness("claude-code", [
      implementTurn,
      {
        act: async ({ env }) => {
          await agentTools(env)("review", {
            verdict: "request_changes",
            summary: "The acceptance criterion is not covered by a test.",
            findings: [
              {
                severity: "blocking",
                file: "done.txt",
                message: "Add a regression test for the marker.",
              },
            ],
          });
        },
      },
      {
        act: async ({ cwd, env, prompt }) => {
          resumePrompt = prompt;
          writeFileSync(join(cwd, "review-fix.txt"), "fixed\n");
          await agentTools(env)("stage", { name: "reviewing", summary: "addressed the review" });
        },
      },
      approveReview,
      finishTurn(),
    ]);
    const outcome = await new JobRunner(deps(harness), claimedJob()).run();
    expect(outcome).toBe("pr_opened");
    expect(resumePrompt).toContain("independent reviewer requested changes");
    expect(resumePrompt).toContain("Add a regression test for the marker.");
    expect(api.named("stage").map((c) => (c.body as { to: string }).to)).toEqual([
      "investigating",
      "implementing",
      "reviewing",
      "implementing",
      "reviewing",
      "verifying",
    ]);
    const reviews = api
      .named("evidence")
      .map((c) => c.body as { kind: string; status: string })
      .filter((e) => e.kind === "review");
    expect(reviews.map((e) => e.status)).toEqual(["failed", "passed"]);
    // A pause while fixing a review finding must resume at implementing, not verifying.
    const back = api
      .named("stage")
      .map((c) => c.body as { to: string; lastCompletedStage?: string })
      .find((s) => s.to === "implementing");
    expect(back?.lastCompletedStage).toBe("investigating");
  });

  it("continues to verifying but records a blocking review when the loop budget is spent", async () => {
    fixture.seedRepo("acme/strict", {
      ".foundry/recipe.yaml": TEST_RECIPE,
      ".foundry/policy.yaml": "max_review_loops: 0\n",
      "README.md": "# strict\n",
    });
    let resumePrompt = "";
    const harness = new FakeHarness("claude-code", [
      implementTurn,
      {
        act: async ({ env }) => {
          await agentTools(env)("review", {
            verdict: "request_changes",
            summary: "Still wrong.",
            findings: [{ severity: "blocking", message: "Fix it." }],
          });
        },
      },
      {
        act: async ({ env, prompt }) => {
          resumePrompt = prompt;
          const call = agentTools(env);
          await call("stage", { name: "verifying", summary: "review budget spent" });
          await call("confidence", { level: "high" });
          await call("stage", { name: "done", summary: "Adds done.txt" });
        },
      },
    ]);
    const job = claimedJob({
      id: "cccccccc-0000-0000-0000-000000000000",
      branch: "foundry/c",
      repo: { id: "repo-strict", fullName: "acme/strict", defaultBranch: "main" },
    });
    expect(await new JobRunner(deps(harness), job).run()).toBe("pr_opened");
    expect(resumePrompt).toContain("still requests changes after 0 review loops");
    expect(resumePrompt).toContain("held for human review");
    const review = api
      .named("evidence")
      .map((c) => c.body as { kind: string; name: string; status: string })
      .find((e) => e.kind === "review" && e.name === "code review");
    expect(review?.status).toBe("failed");
  });

  it("rejects stage(verifying) until the reviewer approves", async () => {
    let reply = "";
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "clear" });
          await call("stage", { name: "implementing", summary: "done" });
          writeFileSync(join(cwd, "done.txt"), "done\n");
          await call("stage", { name: "reviewing", summary: "done" });
          reply = (await call("stage", { name: "verifying", summary: "skip the review" })).text;
        },
      },
      approveReview,
      finishTurn(),
    ]);
    expect(await new JobRunner(deps(harness), claimedJob()).run()).toBe("pr_opened");
    expect(reply).toContain("independent review has not run yet");
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
    const outcome = await new JobRunner(
      { ...deps(harness), maxNudges: 0 },
      claimedJob({ id: "33333333-0000-0000-0000-000000000000", branch: "foundry/3" }),
    ).run();
    expect(reply).toContain("call stage(investigating) first");
    expect(outcome).toBe("failed");
    expect((api.named("stage").at(-1)!.body as { reason: string }).reason).toContain(
      "stopped before finishing",
    );
  });

  it("parks on a question, then resumes the same session in place with the answer", async () => {
    const job = claimedJob({ id: "44444444-0000-0000-0000-000000000000", branch: "foundry/4" });
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ env }) => {
          await agentTools(env)("ask", { question: "CSV or XLSX?", options: ["CSV", "XLSX"] });
        },
      },
      ...happyTurns(),
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
          await call("stage", { name: "reviewing", summary: "done" });
        },
      },
      approveReview,
      finishTurn(),
    ]);
    const portable = claimedJob({ ...job, resumeMode: "portable", resumeStage: "implementing" });
    expect(await new JobRunner(deps(other), portable).run()).toBe("pr_opened");
  });

  it("revokes a job whose harness is stopped before it reports a session id", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    let stopSession!: () => void;
    const harness: HarnessAdapter = {
      id: "claude-code",
      detect: async () => ({ installed: true, authOk: true }),
      start: async (): Promise<HarnessSession> => {
        const events = new AsyncQueue<HarnessEvent>();
        let finish!: (result: SessionResult) => void;
        const done = new Promise<SessionResult>((resolve) => (finish = resolve));
        let rejectId!: (err: Error) => void;
        const id = new Promise<string>((_, reject) => (rejectId = reject));
        stopSession = () => {
          rejectId(new Error("session ended before it started"));
          events.close();
          finish({ status: "stopped" });
        };
        started();
        return { id, events, done };
      },
      resume: async () => {
        throw new Error("not used");
      },
      stop: async () => stopSession(),
    };
    const runner = new JobRunner(deps(harness), claimedJob());
    const running = runner.run();
    await ready;
    await runner.revoke();
    expect(await running).toBe("revoked");
  });

  it("fails a job that exceeds the cost budget", async () => {
    const harness = new FakeHarness("claude-code", [
      {
        events: [{ kind: "usage", tokensIn: 1, tokensOut: 1, costUsd: 11 }],
        act: () => new Promise((r) => setTimeout(r, 5_000)),
      },
    ]);
    const outcome = await new JobRunner(
      deps(harness),
      claimedJob({ id: "66666666-0000-0000-0000-000000000000", branch: "foundry/6" }),
    ).run();
    expect(outcome).toBe("failed");
    expect((api.named("stage").at(-1)!.body as { reason: string }).reason).toContain("max cost");
  });

  it("honours a per-job max cost override", async () => {
    const harness = new FakeHarness("claude-code", [
      { events: [{ kind: "usage", tokensIn: 1, tokensOut: 1, costUsd: 11 }] },
    ]);
    const outcome = await new JobRunner(
      deps(harness),
      claimedJob({
        id: "77777777-0000-0000-0000-000000000000",
        branch: "foundry/7",
        maxCostUsd: 20,
      }),
    ).run();
    expect(outcome).toBe("failed"); // The agent never finishes, but not because of cost.
    expect((api.named("stage").at(-1)!.body as { reason: string }).reason).not.toContain("max cost");
  });

  it("fails a job when its own max execution time is lowered below elapsed time", async () => {
    // Fake only Date: the deadline timer stays real, and moving the clock past the new limit
    // makes the re-arm fire immediately, proving a mid-run change takes effect.
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.now();
    try {
      const harness = new FakeHarness("claude-code", [
        {
          events: [{ kind: "message", role: "agent", text: "still working" }],
          act: () => new Promise<void>(() => {}),
        },
      ]);
      const runner = new JobRunner(deps(harness), claimedJob({ maxJobMinutes: 2 }));
      const running = runner.run();
      // The first flushed event means drive() has armed the deadline.
      for (let i = 0; i < 100 && api.named("events").length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(api.named("events").length).toBeGreaterThan(0);

      vi.setSystemTime(startedAt + 61 * 60_000);
      runner.setMaxJobMinutes(1);
      expect(await running).toBe("failed");
      expect((api.named("stage").at(-1)!.body as { reason: string }).reason).toContain(
        "max execution time (1 minutes)",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("captures a screenshot when a UI change has none", async () => {
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "ui change" });
          await call("stage", { name: "implementing", summary: "add a page" });
          mkdirSync(join(cwd, "apps/web/src/app"), { recursive: true });
          writeFileSync(join(cwd, "apps/web/src/app/page.tsx"), "export default () => null;\n");
          writeFileSync(join(cwd, "done.txt"), "done\n");
          await call("stage", { name: "reviewing", summary: "page added" });
        },
      },
      approveReview,
      {
        act: async ({ env }) => {
          const call = agentTools(env);
          await call("stage", { name: "verifying", summary: "page added" });
          expect((await call("run_checks")).text).toContain("All checks passed");
          await call("confidence", { level: "high" });
          await call("stage", { name: "done", summary: "Adds a page" });
        },
      },
    ]);
    let shot: { url: string; path: string } | null = null;
    const outcome = await new JobRunner(
      deps(harness, async (url, path) => {
        shot = { url, path };
        writeFileSync(path, TINY_PNG);
      }),
      claimedJob({
        id: "99999999-0000-0000-0000-000000000000",
        branch: "foundry/9",
        repo: { id: "repo-ui", fullName: "acme/ui", defaultBranch: "main" },
      }),
    ).run();

    expect(outcome).toBe("pr_opened");
    expect(shot!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(shot!.path.endsWith(".foundry-local/verify.png")).toBe(true);
    const evidence = api.named("evidence").map((c) => c.body as { kind: string; status: string });
    expect(evidence.some((e) => e.kind === "screenshot" && e.status === "passed")).toBe(true);
    expect(api.named("uploadArtifact")).toHaveLength(1);
    expect((api.named("openPr")[0]!.body as { uiChanged: boolean }).uiChanged).toBe(true);
  });

  it("does not start the dev server when the agent already attached a screenshot", async () => {
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "ui change" });
          await call("stage", { name: "implementing", summary: "add a page" });
          mkdirSync(join(cwd, "apps/web/src/app"), { recursive: true });
          writeFileSync(join(cwd, "apps/web/src/app/page.tsx"), "export default () => null;\n");
          writeFileSync(join(cwd, "done.txt"), "done\n");
          writeFileSync(join(cwd, "page.png"), TINY_PNG);
          await call("evidence", { kind: "screenshot", name: "page", path: "page.png" });
          await call("stage", { name: "reviewing", summary: "page added" });
        },
      },
      approveReview,
      {
        act: async ({ env }) => {
          const call = agentTools(env);
          await call("stage", { name: "verifying", summary: "page added" });
          await call("confidence", { level: "high" });
          await call("stage", { name: "done", summary: "Adds a page" });
        },
      },
    ]);
    let captures = 0;
    const outcome = await new JobRunner(
      deps(harness, async (_url, path) => {
        captures++;
        writeFileSync(path, TINY_PNG);
      }),
      claimedJob({
        id: "bbbbbbbb-0000-0000-0000-000000000000",
        branch: "foundry/b",
        repo: { id: "repo-ui", fullName: "acme/ui", defaultBranch: "main" },
      }),
    ).run();

    expect(outcome).toBe("pr_opened");
    expect(captures).toBe(0);
    const screenshots = api
      .named("evidence")
      .map((c) => c.body as { kind: string; name: string })
      .filter((e) => e.kind === "screenshot");
    expect(screenshots).toEqual([
      { kind: "screenshot", name: "page", status: "passed", artifactId: "art-page.png" },
    ]);
  });

  it("fails a UI change when the recipe has no dev_server", async () => {
    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "ui change" });
          await call("stage", { name: "implementing", summary: "add a page" });
          mkdirSync(join(cwd, "apps/web/src/app"), { recursive: true });
          writeFileSync(join(cwd, "apps/web/src/app/page.tsx"), "export default () => null;\n");
          writeFileSync(join(cwd, "done.txt"), "done\n");
          await call("stage", { name: "reviewing", summary: "page added" });
        },
      },
      approveReview,
      {
        act: async ({ env }) => {
          const call = agentTools(env);
          await call("stage", { name: "verifying", summary: "page added" });
          await call("stage", { name: "done", summary: "Adds a page" });
        },
      },
    ]);
    const outcome = await new JobRunner(
      deps(harness),
      claimedJob({ id: "aaaaaaaa-0000-0000-0000-000000000000", branch: "foundry/a" }),
    ).run();

    expect(outcome).toBe("failed");
    expect(api.named("openPr")).toHaveLength(0);
    const last = api.named("stage").at(-1)!.body as { to: string; reason: string };
    expect(last.to).toBe("failed");
    expect(last.reason).toContain("recipe has no dev_server; UI change needs a screenshot");
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
          writeFileSync(
            join(cwd, ".foundry/recipe.yaml"),
            "checks:\n  - name: json\n    run: test -f package.json\n",
          );
          writeFileSync(join(cwd, ".foundry/policy.yaml"), "merge: off\n");
          await call("stage", { name: "reviewing", summary: "files written" });
        },
      },
      approveReview,
      {
        act: async ({ env }) => {
          const call = agentTools(env);
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
    expect(
      gitIn(join(fixture.root, "acme/fresh.git"), "show", `${job.branch}:.foundry/recipe.yaml`),
    ).toContain("test -f package.json");
  });
});
