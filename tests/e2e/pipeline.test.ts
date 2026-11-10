import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requeueLostJobs } from "@foundry/control";
import { events, runners } from "@foundry/db";
import { TEST_DATABASE_URL } from "@foundry/db/testing";
import { FakeHarness, type FakeTurn } from "@foundry/harness-core";
import { agentTools, gitIn } from "@foundry/runner";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { checkSuiteCompleted, createE2E, type E2E, labeledIssue, waitFor } from "./harness";

/**
 * The five M9 pipeline scenarios, driven end to end: real control plane, real runner daemon,
 * real git worktrees, `FakeHarness` instead of a model and `GitBackedGitHub` instead of GitHub.
 *
 * The recipe's only check is `true` so readiness and verify pass on any machine; this file must
 * never run the repo's real checks.
 */
const RECIPE = `
checks:
  - name: ok
    run: "true"
`;

/** A recipe the scheduler may run on either OS (scenario 5 resumes across machines). */
const MULTI_OS_RECIPE = `${RECIPE}os: [macos, linux]
`;

const AUTO_MERGE_POLICY = `merge: merge_when_confident
`;

const RISK_POLICY = `merge: merge_when_confident
risk_rules:
  - name: migrations
    paths: ["db/migrations/**"]
    reviewers: ["carol"]
`;

function writeFile(cwd: string, path: string, content: string): void {
  mkdirSync(join(cwd, path, ".."), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

function shaOf(cwd: string): string {
  return gitIn(cwd, "rev-parse", "HEAD");
}

/** The independent reviewer's turn: approve through its dedicated MCP registration. */
function reviewerApproval(): FakeTurn {
  return {
    act: async ({ env }) => {
      await agentTools(env)("review", { verdict: "approve", summary: "Looks good", findings: [] });
    },
  };
}

/**
 * A well-behaved job: implement, run the independent review, then verify. The reviewing
 * checkpoint commits and pushes the file, so `shaOf(cwd)` is the sha CI will report on.
 */
function finishingTurns(opts: { world: E2E; path: string; content: string; summary: string }): FakeTurn[] {
  return [
    {
      act: async ({ cwd, env }) => {
        const call = agentTools(env);
        await call("stage", { name: "investigating", summary: "Ticket is clear" });
        await call("plan", { plan: `Write ${opts.path}` });
        await call("stage", { name: "implementing", summary: `Writing ${opts.path}` });
        writeFile(cwd, opts.path, opts.content);
        await call("stage", { name: "reviewing", summary: `Wrote ${opts.path}` });
      },
    },
    reviewerApproval(),
    {
      act: async ({ cwd, env }) => {
        const call = agentTools(env);
        opts.world.gh.repo("acme/app").ci.set(shaOf(cwd), "pending");
        await call("stage", { name: "verifying", summary: `Wrote ${opts.path}` });
        await call("confidence", { level: "high", reasons: ["trivial change"], uncertainties: [] });
        await call("stage", { name: "done", summary: opts.summary });
      },
    },
  ];
}

/**
 * Wait until the PR is open with a head sha, then send the green webhook for that sha.
 *
 * `statuses` must include every status the job can settle in before CI arrives. A risk-rule hit
 * hands over as soon as the PR opens (`openPullRequest` evaluates the gate immediately), so the
 * transient `pr_ci` can be gone before the first poll; waiting on `pr_ci` alone flakes there.
 */
async function deliverGreenCi(world: E2E, statuses: string[] = ["pr_ci"]): Promise<string> {
  const job = await waitFor(async () => {
    const j = await world.job();
    return statuses.includes(j.status) && j.headSha ? j : null;
  }, "pull request + head sha");
  const sha = job.headSha!;
  world.gh.repo("acme/app").ci.set(sha, "success");
  await world.deliver("check_suite", checkSuiteCompleted(sha));
  return sha;
}

async function resumedEvents(world: E2E, jobId: string) {
  const rows = await world.ctx.db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.jobId, jobId), eq(events.kind, "resumed")));
  return rows.map((r) => r.payload as { mode: string; runnerName: string });
}

describe.skipIf(!TEST_DATABASE_URL)("pipeline e2e", () => {
  let world: E2E | undefined;

  afterEach(async () => {
    await world?.close();
    world = undefined;
  });

  it("auto-merges after the green CI webhook", { timeout: 30_000 }, async () => {
    const e2e = await createE2E({ recipe: RECIPE, policy: AUTO_MERGE_POLICY });
    world = e2e;
    e2e.gh.addIssue("acme/app", { number: 1, title: "Add done.txt" });
    await e2e.deliver("issues", labeledIssue(1, "Add done.txt"));
    await e2e.startRunner({
      name: "mac",
      os: "macos",
      harness: new FakeHarness("claude-code", [
        ...finishingTurns({ world: e2e, path: "done.txt", content: "done\n", summary: "Adds done.txt" }),
      ]),
    });

    await deliverGreenCi(e2e);
    const job = await waitFor(async () => {
      const j = await e2e.job();
      return j.status === "merged" ? j : null;
    }, "job to auto-merge");
    expect(job.prNumber).not.toBeNull();
    expect(e2e.gh.repo("acme/app").prs.get(job.prNumber!)?.merged).toBe(true);
  });

  it("asks on the issue, takes a checkbox answer, and finishes", { timeout: 30_000 }, async () => {
    const e2e = await createE2E({ recipe: RECIPE });
    world = e2e;
    e2e.gh.addIssue("acme/app", { number: 2, title: "Pick an approach" });
    await e2e.deliver("issues", labeledIssue(2, "Pick an approach"));

    const harness = new FakeHarness("claude-code", [
      {
        act: async ({ env }) => {
          await agentTools(env)("ask", {
            question: "Which approach?",
            options: ["Alpha", "Beta"],
          });
        },
      },
      ...finishingTurns({ world: e2e, path: "done.txt", content: "done\n", summary: "Adds done.txt" }),
    ]);
    const { daemon } = await e2e.startRunner({ name: "mac", os: "macos", harness });

    const waiting = await waitFor(async () => {
      const j = await e2e.job();
      return j.status === "needs_input" ? j : null;
    }, "question to park the job");
    expect(waiting.resumeStage).toBe("triage");

    const comment = e2e.gh.commentsOn("acme/app", 2).find((c) => c.body.includes("foundry:question:"));
    expect(comment).toBeDefined();
    const ticked = comment!.body.replace("- [ ] A.", "- [x] A.");
    await e2e.deliver("issue_comment", {
      action: "edited",
      repository: { id: 4242, full_name: "acme/app", default_branch: "main" },
      sender: { login: "alice", type: "User" },
      issue: { number: 2, title: "Pick an approach", body: "", user: { login: "alice" }, labels: [] },
      comment: { id: comment!.id, body: ticked, user: { login: "foundry[bot]", type: "Bot" } },
    });
    expect((await e2e.job()).status).toBe("queued");

    await waitFor(async () => {
      await daemon.claimLoop();
      const j = await e2e.job();
      return j.status !== "queued" ? j : null;
    }, "job to be re-claimed with the answer");

    const finished = await waitFor(async () => {
      const j = await e2e.job();
      return j.prNumber !== null && j.status === "waiting_on_you" ? j : null;
    }, "pull request to open");
    expect(finished.prNumber).not.toBeNull();
    // Same machine and session: the runner resumes its own session with the answer, starts a
    // separate reviewer session, then resumes the implementer to verify.
    expect(harness.calls.map((c) => c.kind)).toEqual(["start", "resume", "start", "resume"]);
    expect(harness.calls[1]!.prompt).toContain("Alpha");
  });

  it("hands a risk-rule diff to its reviewer instead of auto-merging", { timeout: 30_000 }, async () => {
    const e2e = await createE2E({ recipe: RECIPE, policy: RISK_POLICY });
    world = e2e;
    e2e.gh.addIssue("acme/app", { number: 3, title: "Add a migration" });
    await e2e.deliver("issues", labeledIssue(3, "Add a migration"));
    await e2e.startRunner({
      name: "mac",
      os: "macos",
      harness: new FakeHarness("claude-code", [
        ...finishingTurns({
          world: e2e,
          path: "db/migrations/001.sql",
          content: "create table things (id int);\n",
          summary: "Adds a migration",
        }),
      ]),
    });

    // The risk rule fails the gate at PR-open time, so the job may already be waiting_on_you;
    // the handover ignores a later green CI. Either way it must not merge.
    await deliverGreenCi(e2e, ["pr_ci", "waiting_on_you"]);
    const job = await waitFor(async () => {
      const j = await e2e.job();
      return j.status === "waiting_on_you" ? j : null;
    }, "risk-rule handover");
    expect(job.assignedReviewers).toContain("carol");
    expect(e2e.gh.repo("acme/app").prs.get(job.prNumber!)?.merged).toBe(false);
  });

  it("re-queues an offline runner's job and resumes it portably elsewhere", { timeout: 60_000 }, async () => {
    const e2e = await createE2E({ recipe: RECIPE, policy: AUTO_MERGE_POLICY });
    world = e2e;
    e2e.gh.addIssue("acme/app", { number: 4, title: "Survive a closed lid" });
    await e2e.deliver("issues", labeledIssue(4, "Survive a closed lid"));

    let atImplementing = false;
    const first = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "Ticket is clear" });
          await call("plan", { plan: "Write done.txt" });
          writeFile(cwd, "done.txt", "done\n");
          await call("stage", { name: "implementing", summary: "Wrote done.txt" });
          atImplementing = true;
          // The laptop "goes to sleep": the turn never finishes on its own.
          await new Promise<void>(() => {});
        },
      },
    ]);
    const laptop = await e2e.startRunner({ name: "alice-mbp", os: "macos", harness: first });
    await waitFor(async () => atImplementing, "harness to reach implementing");

    await e2e.ctx.db
      .update(runners)
      .set({ lastSeenAt: new Date(0) })
      .where(eq(runners.id, laptop.runnerId));
    expect(await requeueLostJobs(e2e.ctx)).toEqual([(await e2e.job()).id]);
    expect(await e2e.job()).toMatchObject({ status: "queued", resumeStage: "implementing" });

    const prompts: string[] = [];
    const second = new FakeHarness("claude-code", [
      {
        act: async ({ env, prompt }) => {
          prompts.push(prompt);
          const call = agentTools(env);
          await call("stage", { name: "reviewing", summary: "Continuing from the brief" });
        },
      },
      reviewerApproval(),
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          e2e.gh.repo("acme/app").ci.set(shaOf(cwd), "pending");
          await call("stage", { name: "verifying", summary: "Continuing from the brief" });
          await call("confidence", { level: "high", reasons: ["the brief is enough"], uncertainties: [] });
          await call("stage", { name: "done", summary: "Adds done.txt" });
        },
      },
    ]);
    await e2e.startRunner({ name: "bob-mbp", os: "macos", harness: second });

    await deliverGreenCi(e2e);
    const job = await waitFor(async () => {
      const j = await e2e.job();
      return j.status === "merged" ? j : null;
    }, "job to finish after portable resume");
    expect(prompts[0]).toContain("Write done.txt"); // the plan travelled in the brief
    expect(await resumedEvents(e2e, job.id)).toContainEqual(
      expect.objectContaining({ mode: "portable", runnerName: "bob-mbp" }),
    );
  });

  it("resumes a macOS job on a Linux runner when the recipe allows both", { timeout: 60_000 }, async () => {
    const e2e = await createE2E({ recipe: MULTI_OS_RECIPE, policy: AUTO_MERGE_POLICY });
    world = e2e;
    e2e.gh.addIssue("acme/app", { number: 5, title: "Move to the office mini" });
    await e2e.deliver("issues", labeledIssue(5, "Move to the office mini"));

    let atImplementing = false;
    const first = new FakeHarness("claude-code", [
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          await call("stage", { name: "investigating", summary: "Ticket is clear" });
          await call("plan", { plan: "Write done.txt" });
          writeFile(cwd, "done.txt", "done\n");
          await call("stage", { name: "implementing", summary: "Wrote done.txt" });
          atImplementing = true;
          await new Promise<void>(() => {});
        },
      },
    ]);
    const mac = await e2e.startRunner({ name: "alice-mbp", os: "macos", harness: first });
    await waitFor(async () => atImplementing, "harness to reach implementing");

    await e2e.ctx.db
      .update(runners)
      .set({ lastSeenAt: new Date(0) })
      .where(eq(runners.id, mac.runnerId));
    await requeueLostJobs(e2e.ctx);

    const second = new FakeHarness("claude-code", [
      {
        act: async ({ env }) => {
          const call = agentTools(env);
          await call("stage", { name: "reviewing", summary: "Continuing on Linux" });
        },
      },
      reviewerApproval(),
      {
        act: async ({ cwd, env }) => {
          const call = agentTools(env);
          e2e.gh.repo("acme/app").ci.set(shaOf(cwd), "pending");
          await call("stage", { name: "verifying", summary: "Continuing on Linux" });
          await call("confidence", { level: "high", reasons: ["the brief is enough"], uncertainties: [] });
          await call("stage", { name: "done", summary: "Adds done.txt" });
        },
      },
    ]);
    const linux = await e2e.startRunner({ name: "bob-linux", os: "linux", harness: second });

    await deliverGreenCi(e2e);
    const job = await waitFor(async () => {
      const j = await e2e.job();
      return j.status === "merged" ? j : null;
    }, "job to finish on the Linux runner");
    const linuxRow = await e2e.ctx.db.query.runners.findFirst({ where: eq(runners.id, linux.runnerId) });
    expect(linuxRow?.os).toBe("linux");
    expect(await resumedEvents(e2e, job.id)).toContainEqual(
      expect.objectContaining({ mode: "portable", runnerName: "bob-linux" }),
    );
  });
});
