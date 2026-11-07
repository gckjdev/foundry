import { teams } from "@foundry/db";
import { TEST_DATABASE_URL } from "@foundry/db/testing";
import { stageLabel } from "@foundry/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimJob } from "./claim";
import { processWebhook, storeWebhook } from "./ingest";
import { getJob } from "./jobs";
import { evaluateJobGate } from "./merge-gate";
import { openPullRequest } from "./prs";
import { answerFromCheckbox } from "./questions";
import { runnerAsk, runnerConfidence, runnerEvidence, runnerStage } from "./runner-api";
import { createJoinToken, heartbeat, joinRunner } from "./runners";
import { requeueLostJobs } from "./sweeper";
import { syncUnlinkedInstallations } from "./teams";
import {
  createTestEnv,
  issueLabeledPayload,
  seedRunner,
  seedTeam,
  type TestEnv,
  touchRunner,
} from "./testing";

async function deliver(env: TestEnv, event: string, payload: unknown, id: string = crypto.randomUUID()) {
  const rowId = await storeWebhook(env.ctx, id, event, payload);
  if (rowId !== null) await processWebhook(env.ctx, rowId);
  return rowId;
}

describe.skipIf(!TEST_DATABASE_URL)("control plane", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(async () => {
    await env.drop();
  });

  it("creates one job per labeled issue and dedupes deliveries", async () => {
    const { repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 7, title: "Fix login", labels: ["foundry"] });
    const payload = issueLabeledPayload({
      number: 7,
      title: "Fix login",
      labels: ["foundry", "harness:opencode"],
    });
    expect(await deliver(env, "issues", payload, "d1")).not.toBeNull();
    expect(await deliver(env, "issues", payload, "d1")).toBeNull();
    await deliver(env, "issues", payload, "d2");
    const rows = await env.ctx.db.query.jobs.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repoId: repo.id, issueNumber: 7, harness: "opencode", status: "queued" });
    const comments = env.gh.commentsOn("acme/app", 7);
    expect(comments[0]?.body).toContain("foundry:status:");
    expect((await env.gh.getIssue({ installationId: 1, fullName: "acme/app" }, 7)).labels).toContain(
      stageLabel("queued"),
    );
  });

  it("joins a runner with a signed token and heartbeats", async () => {
    const { team, alice } = await seedTeam(env);
    const token = createJoinToken(env.ctx, team.id, alice.id);
    const joined = await joinRunner(env.ctx, {
      joinToken: token,
      name: "alice-mbp",
      kind: "personal",
      os: "macos",
      arch: "arm64",
      osVersion: "15.1",
      cpu: 10,
      memMb: 32000,
      maxConcurrency: 1,
    });
    expect(joined.teamId).toBe(team.id);
    const runner = (await env.ctx.db.query.runners.findFirst())!;
    expect(runner.ownerUserId).toBe(alice.id);
    const hb = await heartbeat(env.ctx, runner, {
      cpu: 10,
      memMb: 32000,
      diskFreeMb: 100000,
      onAcPower: true,
      accepting: true,
      runningJobIds: ["00000000-0000-0000-0000-000000000000"],
      harnesses: [{ id: "claude-code", installed: true, authOk: true }],
      maxConcurrency: 1,
      version: "0.1.0",
    });
    expect(hb.revokedJobIds).toEqual(["00000000-0000-0000-0000-000000000000"]);
    expect(hb.repos).toHaveLength(1);
    await expect(
      joinRunner(env.ctx, {
        ...{ joinToken: "fdj_bad" },
        name: "x",
        kind: "shared",
        os: "linux",
        arch: "x64",
        osVersion: "1",
        cpu: 1,
        memMb: 1,
        maxConcurrency: 1,
      }),
    ).rejects.toThrow();
  });

  it("prefers the shared runner and never double-claims", async () => {
    const { team, repo, alice } = await seedTeam(env);
    const laptop = await seedRunner(env, team.id, repo.id, { name: "alice-mbp", ownerUserId: alice.id });
    const shared = await seedRunner(env, team.id, repo.id, {
      name: "office-mini",
      kind: "shared",
      os: "linux",
    });
    env.gh.addIssue("acme/app", { number: 1, title: "One" });
    await deliver(env, "issues", issueLabeledPayload({ number: 1, title: "One" }));
    expect(await claimJob(env.ctx, laptop)).toBeNull();
    const claimed = await claimJob(env.ctx, shared);
    expect(claimed).toMatchObject({ resumeStage: "triage", resumeMode: "fresh" });
    expect(await claimJob(env.ctx, shared)).toBeNull();
    expect((await getJob(env.ctx, claimed!.id)).status).toBe("triage");
  });

  it("asks on the issue, takes a checkbox answer and resumes on the same runner", async () => {
    const { team, repo } = await seedTeam(env);
    const runner = await seedRunner(env, team.id, repo.id, { name: "alice-mbp" });
    env.gh.addIssue("acme/app", { number: 3, title: "Add export" });
    await deliver(env, "issues", issueLabeledPayload({ number: 3, title: "Add export" }));
    const claimed = (await claimJob(env.ctx, runner))!;
    await runnerStage(env.ctx, runner, claimed.id, {
      to: "investigating",
      lastCompletedStage: "triage",
      sessionId: "sess-1",
    });
    const q = await runnerAsk(env.ctx, runner, claimed.id, "CSV or XLSX?", ["CSV", "XLSX"]);
    expect((await getJob(env.ctx, claimed.id)).status).toBe("needs_input");
    expect(env.notifier.sent.map((n) => n.event)).toContain("question_asked");

    const comment = env.gh.commentsOn("acme/app", 3).find((c) => c.body.includes("foundry:question:"))!;
    const ticked = comment.body.replace("- [ ] B.", "- [x] B.");
    await deliver(env, "issue_comment", {
      action: "edited",
      repository: { id: 4242, full_name: "acme/app", default_branch: "main" },
      sender: { login: "alice", type: "User" },
      issue: { number: 3, title: "Add export", body: "", user: { login: "alice" }, labels: [] },
      comment: { id: comment.id, body: ticked, user: { login: "foundry[bot]", type: "Bot" } },
    });
    expect(await answerFromCheckbox(env.ctx, q.id, ticked, "alice")).toBeNull(); // already answered
    await touchRunner(env, runner.id);
    const resumed = (await claimJob(env.ctx, runner))!;
    expect(resumed).toMatchObject({
      resumeStage: "investigating",
      resumeMode: "sticky",
      sessionId: "sess-1",
    });
    expect(resumed.pendingInputs).toEqual([
      { kind: "answer", text: "XLSX", by: "alice", questionPrompt: "CSV or XLSX?" },
    ]);
  });

  it("re-queues a job when its laptop goes offline and resumes portably elsewhere", async () => {
    const { team, repo } = await seedTeam(env);
    const laptop = await seedRunner(env, team.id, repo.id, { name: "alice-mbp" });
    env.gh.addIssue("acme/app", { number: 4, title: "Lid closed" });
    await deliver(env, "issues", issueLabeledPayload({ number: 4, title: "Lid closed" }));
    const claimed = (await claimJob(env.ctx, laptop))!;
    await runnerStage(env.ctx, laptop, claimed.id, {
      to: "investigating",
      lastCompletedStage: "triage",
      sessionId: "s",
    });
    await runnerStage(env.ctx, laptop, claimed.id, {
      to: "implementing",
      lastCompletedStage: "investigating",
    });

    env.clock.advance(3 * 60_000);
    const other = await seedRunner(env, team.id, repo.id, { name: "bob-linux", os: "linux" });
    expect(await requeueLostJobs(env.ctx)).toEqual([claimed.id]);
    const job = await getJob(env.ctx, claimed.id);
    expect(job).toMatchObject({ status: "queued", resumeStage: "implementing", stickyRunnerId: laptop.id });
    // The laptop holds a sticky window, but it is offline, so another runner may take it.
    const resumed = (await claimJob(env.ctx, other))!;
    expect(resumed).toMatchObject({ resumeStage: "implementing", resumeMode: "portable", sessionId: null });
  });

  it("auto-merges when every gate rule passes, otherwise hands over with routed reviewers", async () => {
    const policy = `merge: merge_when_confident\nrisk_rules:\n  - name: migrations\n    paths: ["db/migrations/**"]\n    reviewers: ["@acme/dba", "carol"]\n`;
    const { team, repo } = await seedTeam(env, { policyYaml: policy });
    const runner = await seedRunner(env, team.id, repo.id, { name: "mini", kind: "shared" });
    const fake = env.gh.repo("acme/app");

    const runToPr = async (
      number: number,
      files: { filename: string; additions: number; deletions: number }[],
    ) => {
      env.gh.addIssue("acme/app", { number, title: `Ticket ${number}` });
      await deliver(env, "issues", issueLabeledPayload({ number, title: `Ticket ${number}` }));
      const c = (await claimJob(env.ctx, runner))!;
      for (const [to, last] of [
        ["investigating", "triage"],
        ["implementing", "investigating"],
        ["verifying", "implementing"],
      ] as const) {
        await runnerStage(env.ctx, runner, c.id, { to, lastCompletedStage: last });
      }
      for (const name of ["test", "lint"])
        await runnerEvidence(env.ctx, runner, c.id, { kind: "check", name, status: "passed" });
      await runnerConfidence(env.ctx, runner, c.id, {
        level: "high",
        reasons: ["tests cover it"],
        uncertainties: [],
      });
      fake.branches.set(c.branch, `sha-${number}`);
      fake.ci.set(`sha-${number}`, "pending");
      const pr = await openPullRequest(env.ctx, await getJob(env.ctx, c.id), {
        title: `Fix ${number}`,
        summary: "Done",
        headSha: `sha-${number}`,
        uiChanged: false,
        changedLines: 10,
      });
      fake.prFiles.set(pr.prNumber, files);
      return { jobId: c.id, pr };
    };

    const a = await runToPr(10, [{ filename: "src/a.ts", additions: 5, deletions: 1 }]);
    expect((await getJob(env.ctx, a.jobId)).status).toBe("pr_ci"); // CI pending
    expect(fake.prs.get(a.pr.prNumber)?.body).toContain("Closes #10");
    fake.ci.set("sha-10", "success");
    await deliver(env, "check_suite", {
      action: "completed",
      repository: { id: 4242 },
      check_suite: { head_sha: "sha-10" },
    });
    expect((await getJob(env.ctx, a.jobId)).status).toBe("merged");
    expect(fake.prs.get(a.pr.prNumber)?.merged).toBe(true);

    const b = await runToPr(11, [{ filename: "db/migrations/001.sql", additions: 3, deletions: 0 }]);
    fake.ci.set("sha-11", "success");
    await evaluateJobGate(env.ctx, b.jobId);
    const handed = await getJob(env.ctx, b.jobId);
    expect(handed.status).toBe("waiting_on_you");
    expect(fake.requestedReviewers.get(b.pr.prNumber)).toEqual({ users: ["carol"], teams: ["dba"] });
    expect(env.notifier.sent.map((n) => n.event)).toEqual(expect.arrayContaining(["merged", "handover"]));

    // A changes-requested review sends the job back to implementing.
    await deliver(env, "pull_request_review", {
      action: "submitted",
      repository: { id: 4242 },
      pull_request: { number: b.pr.prNumber, merged: false, head: { sha: "sha-11", ref: "x" } },
      review: {
        state: "changes_requested",
        body: "Use a reversible migration",
        user: { login: "carol", type: "User" },
      },
    });
    expect(await getJob(env.ctx, b.jobId)).toMatchObject({ status: "queued", resumeStage: "implementing" });
  });

  it("syncs unlinked GitHub App installations onto the current team", async () => {
    const { team } = await seedTeam(env);
    env.gh.installations.set(99, [{ id: 99, fullName: "acme/other", defaultBranch: "main" }]);
    env.gh.appInstallations.push(
      { id: 1, accountLogin: "acme", accountType: "Organization" },
      { id: 99, accountLogin: "acme", accountType: "Organization" },
    );
    env.gh.installations.set(1, [{ id: 4242, fullName: "acme/app", defaultBranch: "main" }]);
    const linked = await syncUnlinkedInstallations(env.ctx, team.id);
    expect(linked.map((r) => r.fullName).sort()).toEqual(["acme/app", "acme/other"]);
    const [other] = await env.ctx.db.insert(teams).values({ name: "other" }).returning();
    const stolen = await syncUnlinkedInstallations(env.ctx, other!.id);
    expect(stolen).toEqual([]);
  });
});
