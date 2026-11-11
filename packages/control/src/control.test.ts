import { events, jobs, repos, runnerRepoReadiness, teams, users } from "@foundry/db";
import { TEST_DATABASE_URL } from "@foundry/db/testing";
import { stageLabel } from "@foundry/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storeArtifact } from "./artifacts";
import { claimJob } from "./claim";
import { processWebhook, storeWebhook } from "./ingest";
import {
  addInput,
  cancelJob,
  getJob,
  reconcileLabeledIssues,
  retryJob,
  sendMessage,
  setJobMaxCost,
  setJobMaxMinutes,
  takePendingInputs,
} from "./jobs";
import { evaluateJobGate, reconcileChangesRequestedReviews, reconcileOpenPullRequests } from "./merge-gate";
import { capacityCard } from "./metrics";
import { NO_CI_GRACE_MS, submitPrReview } from "./pr-review";
import { openPullRequest } from "./prs";
import { boardJobs, inbox, teamReposWithReadiness } from "./queries";
import { answerFromCheckbox } from "./questions";
import { runnerAsk, runnerConfidence, runnerEvidence, runnerPrReview, runnerStage } from "./runner-api";
import { createJoinToken, heartbeat, joinRunner } from "./runners";
import { DROPPED_JOB_GRACE_MS, requeueDroppedJobs, requeueLostJobs } from "./sweeper";
import { syncUnlinkedInstallations } from "./teams";
import {
  createTestEnv,
  issueLabeledPayload,
  seedRunner,
  seedTeam,
  TEST_RECIPE,
  type TestEnv,
  touchRunner,
} from "./testing";

/** A 1x1 transparent PNG: enough to exercise the attachment path. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

  it("carries images attached to a panel message through to the runner", async () => {
    const { team } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 8, title: "Screenshot bug" });
    await deliver(env, "issues", issueLabeledPayload({ number: 8, title: "Screenshot bug" }));
    const job = (await env.ctx.db.query.jobs.findFirst())!;
    const artifact = await storeArtifact(env.ctx, {
      teamId: team.id,
      jobId: job.id,
      name: "before.png",
      contentType: "image/png",
      bytes: TINY_PNG,
    });

    await sendMessage(env.ctx, job.id, "It looks like this", "alice", [artifact.id]);

    const [input] = await takePendingInputs(env.ctx, job.id);
    expect(input).toMatchObject({ kind: "message", text: "It looks like this", by: "alice" });
    expect(input!.attachments).toEqual([
      {
        artifactId: artifact.id,
        name: "before.png",
        contentType: "image/png",
        url: expect.stringContaining(`/api/artifacts/${artifact.id}?t=`),
      },
    ]);
  });

  it("rejects an attachment that belongs to another job", async () => {
    const { team } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 18, title: "First" });
    env.gh.addIssue("acme/app", { number: 19, title: "Second" });
    await deliver(env, "issues", issueLabeledPayload({ number: 18, title: "First" }));
    await deliver(env, "issues", issueLabeledPayload({ number: 19, title: "Second" }));
    const first = (await env.ctx.db.query.jobs.findFirst({ where: eq(jobs.issueNumber, 18) }))!;
    const second = (await env.ctx.db.query.jobs.findFirst({ where: eq(jobs.issueNumber, 19) }))!;
    const artifact = await storeArtifact(env.ctx, {
      teamId: team.id,
      jobId: first.id,
      name: "other.png",
      contentType: "image/png",
      bytes: TINY_PNG,
    });

    await expect(sendMessage(env.ctx, second.id, "Wrong job", "alice", [artifact.id])).rejects.toThrow(
      /not found/,
    );
    expect(await takePendingInputs(env.ctx, second.id)).toEqual([]);
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

  it("shows my queued jobs blocked without a runner, and only mine", async () => {
    const { team, repo, alice } = await seedTeam(env);
    const [bob] = await env.ctx.db
      .insert(users)
      .values({ ghLogin: "bob", email: "bob@acme.test" })
      .returning();
    const insert = async (title: string, authorId: string, authorLogin: string) => {
      const [job] = await env.ctx.db
        .insert(jobs)
        .values({
          teamId: team.id,
          repoId: repo.id,
          title,
          harness: "claude-code",
          branch: `foundry/${crypto.randomUUID()}`,
          authorUserId: authorId,
          authorLogin,
        })
        .returning();
      return job!;
    };
    const mine = await insert("Blocked for alice", alice.id, "alice");
    const theirs = await insert("Blocked for bob", bob!.id, "bob");

    // No runner has joined the team, so the queued jobs cannot be claimed.
    const aliceBox = await inbox(env.ctx, team.id, alice.id);
    expect(aliceBox.blocked).toHaveLength(1);
    expect(aliceBox.blocked[0]).toMatchObject({
      job: { id: mine.id, status: "queued" },
      reason: "no runners joined",
    });

    const bobBox = await inbox(env.ctx, team.id, bob!.id);
    expect(bobBox.blocked.map((b) => b.job.id)).toEqual([theirs.id]);
  });

  it("reports the hours the queue had no online runner", async () => {
    const { team, repo } = await seedTeam(env);
    const now = env.ctx.now();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
    const insertJob = async (title: string) => {
      const [job] = await env.ctx.db
        .insert(jobs)
        .values({
          teamId: team.id,
          repoId: repo.id,
          title,
          harness: "claude-code",
          branch: `foundry/${crypto.randomUUID()}`,
        })
        .returning();
      return job!;
    };
    const event = (jobId: string, at: Date, from: string | null, to: string) =>
      env.ctx.db.insert(events).values({
        jobId,
        teamId: team.id,
        ts: at,
        kind: "stage_changed",
        stage: to,
        payload: { kind: "stage_changed", from, to },
      });

    // No runner joined, so the queued job has had nobody to pick it up for six hours.
    const waited = await insertJob("Waited overnight");
    // A second job queued and claimed inside that interval: the union must not double-count it.
    const claimed = await insertJob("Claimed later");
    await event(waited.id, hoursAgo(6), null, "queued");
    await event(claimed.id, hoursAgo(5), null, "queued");
    await event(claimed.id, hoursAgo(3), "queued", "triage");

    const card = await capacityCard(env.ctx, team.id);
    expect(card.hoursNoOnlineRunner).toBeCloseTo(6, 1);
    expect(card.hoursQueueWithNoRunner).toBeCloseTo(6, 1);
    expect(card.estimatedHoursSavedBySharedRunner).toBeCloseTo(6, 1);
  });

  it("reports keepJobIds for needs_input and in-progress jobs it still owns", async () => {
    const { team, repo } = await seedTeam(env);
    const runner = await seedRunner(env, team.id, repo.id, { name: "alice-mbp" });
    const other = await seedRunner(env, team.id, repo.id, { name: "office-mini" });
    const insert = async (status: string, runnerId: string | null) => {
      const [job] = await env.ctx.db
        .insert(jobs)
        .values({
          teamId: team.id,
          repoId: repo.id,
          title: `Job ${status}`,
          harness: "claude-code",
          branch: `foundry/${crypto.randomUUID()}`,
          status,
          runnerId,
        })
        .returning();
      return job!;
    };
    const parked = await insert("needs_input", runner.id);
    const running = await insert("verifying", runner.id);
    await insert("queued", null);
    await insert("needs_input", other.id);

    const hb = await heartbeat(env.ctx, runner, {
      cpu: 10,
      memMb: 32000,
      diskFreeMb: 100000,
      onAcPower: true,
      accepting: true,
      runningJobIds: [running.id],
      harnesses: [{ id: "claude-code", installed: true, authOk: true }],
      maxConcurrency: 1,
      version: "0.1.0",
    });
    expect([...hb.keepJobIds].sort()).toEqual([parked.id, running.id].sort());
    expect(hb.revokedJobIds).toEqual([]);
  });

  it("saves a per-job max execution time and reports it in heartbeats", async () => {
    const { team, repo } = await seedTeam(env);
    const runner = await seedRunner(env, team.id, repo.id, { name: "alice-mbp" });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Long job",
        harness: "claude-code",
        branch: `foundry/${crypto.randomUUID()}`,
        status: "implementing",
        runnerId: runner.id,
      })
      .returning();

    await setJobMaxMinutes(env.ctx, team.id, job!.id, 90);
    expect((await getJob(env.ctx, job!.id)).maxJobMinutes).toBe(90);
    await expect(setJobMaxMinutes(env.ctx, crypto.randomUUID(), job!.id, 30)).rejects.toThrow();

    const hb = await heartbeat(env.ctx, runner, {
      cpu: 10,
      memMb: 32000,
      diskFreeMb: 100000,
      onAcPower: true,
      accepting: true,
      runningJobIds: [job!.id],
      harnesses: [{ id: "claude-code", installed: true, authOk: true }],
      maxConcurrency: 1,
      version: "0.1.0",
    });
    expect(hb.jobLimits).toEqual([{ jobId: job!.id, maxJobMinutes: 90, maxCostUsd: null }]);
  });

  it("saves a per-job max cost and reports it in heartbeats", async () => {
    const { team, repo } = await seedTeam(env);
    const runner = await seedRunner(env, team.id, repo.id, { name: "alice-mbp" });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Pricey job",
        harness: "claude-code",
        branch: `foundry/${crypto.randomUUID()}`,
        status: "implementing",
        runnerId: runner.id,
      })
      .returning();

    await setJobMaxCost(env.ctx, team.id, job!.id, 12.5);
    expect((await getJob(env.ctx, job!.id)).maxCostUsd).toBe(12.5);
    await expect(setJobMaxCost(env.ctx, crypto.randomUUID(), job!.id, 20)).rejects.toThrow();
    await expect(setJobMaxCost(env.ctx, team.id, job!.id, 0)).rejects.toThrow();

    const hb = await heartbeat(env.ctx, runner, {
      cpu: 10,
      memMb: 32000,
      diskFreeMb: 100000,
      onAcPower: true,
      accepting: true,
      runningJobIds: [job!.id],
      harnesses: [{ id: "claude-code", installed: true, authOk: true }],
      maxConcurrency: 1,
      version: "0.1.0",
    });
    expect(hb.jobLimits).toEqual([{ jobId: job!.id, maxJobMinutes: null, maxCostUsd: 12.5 }]);
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

  it("returns a claimed job even when GitHub sync never completes", async () => {
    const { repo } = await seedTeam(env);
    const runner = await seedRunner(env, repo.teamId, repo.id, { name: "alice-mbp" });
    env.gh.addIssue("acme/app", { number: 20, title: "Do not block claim on GitHub" });
    await deliver(env, "issues", issueLabeledPayload({ number: 20, title: "Do not block claim on GitHub" }));
    env.gh.createComment = () => new Promise(() => {});
    env.gh.updateComment = () => new Promise(() => {});
    env.gh.addLabels = () => new Promise(() => {});
    env.gh.removeLabel = () => new Promise(() => {});
    const started = Date.now();
    const claimed = await claimJob(env.ctx, runner);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(claimed).toMatchObject({ title: "Do not block claim on GitHub" });
    expect((await getJob(env.ctx, claimed!.id)).status).toBe("triage");
  });

  it("re-queues a job the online runner still owns but is not running", async () => {
    const { team, repo } = await seedTeam(env);
    const runner = await seedRunner(env, team.id, repo.id, { name: "alice-mbp" });
    env.gh.addIssue("acme/app", { number: 21, title: "Dropped after claim" });
    await deliver(env, "issues", issueLabeledPayload({ number: 21, title: "Dropped after claim" }));
    const claimed = (await claimJob(env.ctx, runner))!;
    expect((await getJob(env.ctx, claimed.id)).status).toBe("triage");

    const beat = {
      cpu: 10,
      memMb: 32000,
      diskFreeMb: 100000,
      onAcPower: true,
      accepting: true,
      runningJobIds: [] as string[],
      harnesses: [{ id: "claude-code", installed: true, authOk: true }],
      maxConcurrency: 1,
      version: "0.1.0",
    };
    await heartbeat(env.ctx, runner, beat);
    expect((await getJob(env.ctx, claimed.id)).status).toBe("triage");

    env.clock.advance(DROPPED_JOB_GRACE_MS + 1);
    expect(await requeueDroppedJobs(env.ctx, runner, [])).toEqual([claimed.id]);
    expect(await getJob(env.ctx, claimed.id)).toMatchObject({
      status: "queued",
      resumeStage: "triage",
      stickyRunnerId: runner.id,
    });

    await env.ctx.db
      .update(jobs)
      .set({ status: "triage", runnerId: runner.id })
      .where(eq(jobs.id, claimed.id));
    env.clock.advance(DROPPED_JOB_GRACE_MS + 1);
    await heartbeat(env.ctx, runner, { ...beat, runningJobIds: [claimed.id] });
    expect((await getJob(env.ctx, claimed.id)).status).toBe("triage");
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
        ["reviewing", "implementing"],
        ["verifying", "reviewing"],
      ] as const) {
        await runnerStage(env.ctx, runner, c.id, { to, lastCompletedStage: last });
      }
      for (const name of ["test", "lint"])
        await runnerEvidence(env.ctx, runner, c.id, { kind: "check", name, status: "passed" });
      await runnerEvidence(env.ctx, runner, c.id, {
        kind: "review",
        name: "code review",
        status: "passed",
      });
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
        id: 9001,
        state: "changes_requested",
        body: "Use a reversible migration",
        user: { login: "carol", type: "User" },
      },
    });
    expect(await getJob(env.ctx, b.jobId)).toMatchObject({ status: "queued", resumeStage: "implementing" });
  });

  it("auto-reviews the PR after CI and sends blocking findings back to implementing", async () => {
    const { team, repo } = await seedTeam(env, {
      policyYaml: "auto_pr_review: true\nmerge: merge_when_confident\n",
    });
    const runner = await seedRunner(env, team.id, repo.id, { name: "mac", os: "macos" });
    const fake = env.gh.repo("acme/app");
    env.gh.addIssue("acme/app", { number: 20, title: "Auto review" });
    await deliver(env, "issues", issueLabeledPayload({ number: 20, title: "Auto review" }));
    const c = (await claimJob(env.ctx, runner))!;
    for (const [to, last] of [
      ["investigating", "triage"],
      ["implementing", "investigating"],
      ["reviewing", "implementing"],
      ["verifying", "reviewing"],
    ] as const) {
      await runnerStage(env.ctx, runner, c.id, { to, lastCompletedStage: last });
    }
    for (const name of ["test", "lint"])
      await runnerEvidence(env.ctx, runner, c.id, { kind: "check", name, status: "passed" });
    await runnerEvidence(env.ctx, runner, c.id, { kind: "review", name: "code review", status: "passed" });
    await runnerConfidence(env.ctx, runner, c.id, { level: "high", reasons: ["ok"], uncertainties: [] });
    fake.branches.set(c.branch, "sha-20");
    fake.ci.set("sha-20", "pending");
    const pr = await openPullRequest(env.ctx, await getJob(env.ctx, c.id), {
      title: "Auto review",
      summary: "Done",
      headSha: "sha-20",
      uiChanged: false,
      changedLines: 10,
    });
    fake.prFiles.set(pr.prNumber, [{ filename: "src/a.ts", additions: 5, deletions: 1 }]);
    fake.ci.set("sha-20", "failure");
    env.gh.seedCheckFailures("acme/app", "sha-20", [
      {
        name: "test",
        conclusion: "failure",
        summary: "1 test failed",
        detailsUrl: null,
        annotations: [{ path: "src/a.ts", line: 3, message: "expected 1" }],
      },
    ]);
    await deliver(env, "check_suite", {
      action: "completed",
      repository: { id: 4242 },
      check_suite: { head_sha: "sha-20" },
    });
    expect(await getJob(env.ctx, c.id)).toMatchObject({
      status: "queued",
      resumeStage: "pr_review",
      prReviewSha: "sha-20",
      // Stamped so a lost runner resumes at `pr_review`, not `verifying`.
      lastCompletedStage: "verifying",
    });

    const reviewJob = (await claimJob(env.ctx, runner))!;
    expect(reviewJob.resumeStage).toBe("pr_review");
    expect(reviewJob.prReview).toMatchObject({ prNumber: pr.prNumber, headSha: "sha-20" });
    expect(reviewJob.prReview!.ciFailures[0]).toMatchObject({
      name: "test",
      annotations: [{ path: "src/a.ts", line: 3, message: "expected 1" }],
    });

    const result = await runnerPrReview(env.ctx, runner, c.id, {
      verdict: "request_changes",
      summary: "The test fails",
      findings: [
        { severity: "blocking", category: "code_quality", file: "src/a.ts", line: 3, message: "fix it" },
      ],
    });
    expect(result.status).toBe("queued");
    expect(await getJob(env.ctx, c.id)).toMatchObject({
      status: "queued",
      resumeStage: "implementing",
      prReviewCount: 1,
    });
    expect(env.gh.reviewsOn("acme/app", pr.prNumber)).toHaveLength(1);
    expect(env.gh.reviewsOn("acme/app", pr.prNumber)[0]).toMatchObject({
      author: "foundry[bot]",
      state: "COMMENTED",
    });
    const [input] = await takePendingInputs(env.ctx, c.id);
    expect(input).toMatchObject({ kind: "message", by: "foundry[bot]" });
    expect(input!.text).toContain("automatic PR review");

    // The fix pushes a new head SHA; its CI completion starts a second review while the round
    // count carries over.
    await env.ctx.db.update(jobs).set({ status: "pr_ci", headSha: "sha-20b" }).where(eq(jobs.id, c.id));
    fake.branches.set(c.branch, "sha-20b");
    fake.ci.set("sha-20b", "success");
    fake.prs.get(pr.prNumber)!.headSha = "sha-20b";
    await evaluateJobGate(env.ctx, c.id);
    expect(await getJob(env.ctx, c.id)).toMatchObject({
      status: "queued",
      resumeStage: "pr_review",
      prReviewSha: "sha-20b",
      prReviewCount: 1,
    });
  });

  it("returns an approved automatic PR review to pr_ci", async () => {
    const { team, repo } = await seedTeam(env, { policyYaml: "auto_pr_review: true\n" });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Review me",
        harness: "claude-code",
        branch: "foundry/review-me",
        status: "pr_review",
        prNumber: 11,
        prUrl: "https://github.com/acme/app/pull/11",
        headSha: "sha-11",
      })
      .returning();
    const updated = await submitPrReview(env.ctx, job!, {
      verdict: "approve",
      summary: "Looks good",
      findings: [],
    });
    expect(updated.status).toBe("pr_ci");
    expect(env.gh.reviewsOn("acme/app", 11)[0]).toMatchObject({
      state: "COMMENTED",
      body: expect.stringContaining("Approved"),
    });
  });

  it("starts the automatic review from the worker when a repo has no CI checks", async () => {
    const { team, repo } = await seedTeam(env, { policyYaml: "auto_pr_review: true\n" });
    const fake = env.gh.repo("acme/app");
    fake.branches.set("foundry/no-ci", "sha-22");
    const pr = await env.gh.createPullRequest(
      { installationId: 1, fullName: "acme/app" },
      { head: "foundry/no-ci", base: "main", title: "No CI", body: "" },
    );
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "No CI",
        harness: "claude-code",
        branch: "foundry/no-ci",
        status: "pr_ci",
        prNumber: pr.number,
        prUrl: pr.url,
        headSha: "sha-22",
        prCiEnteredAt: env.ctx.now(),
      })
      .returning();
    fake.ci.set("sha-22", "none");

    // The webhook path waits for checks; the worker's pass must not deadlock the job forever.
    await evaluateJobGate(env.ctx, job!.id);
    expect((await getJob(env.ctx, job!.id)).status).toBe("pr_ci");
    // Nor may a `none` seen immediately after the PR opens beat a check suite that is still
    // registering: the head SHA would be marked reviewed before CI ever ran.
    await evaluateJobGate(env.ctx, job!.id, { allowNoCi: true });
    expect((await getJob(env.ctx, job!.id)).status).toBe("pr_ci");
    env.clock.advance(NO_CI_GRACE_MS + 1);
    await evaluateJobGate(env.ctx, job!.id, { allowNoCi: true });
    expect(await getJob(env.ctx, job!.id)).toMatchObject({
      status: "queued",
      resumeStage: "pr_review",
      prReviewSha: "sha-22",
    });
  });

  it("hands an automatic review over when the loop budget is spent", async () => {
    const { team, repo } = await seedTeam(env, {
      policyYaml: "auto_pr_review: true\nmax_review_loops: 2\n",
    });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Budget spent",
        harness: "claude-code",
        branch: "foundry/budget",
        status: "pr_review",
        prNumber: 31,
        prUrl: "https://github.com/acme/app/pull/31",
        headSha: "sha-23",
        prReviewCount: 2,
        authorLogin: "alice",
      })
      .returning();
    const updated = await submitPrReview(env.ctx, job!, {
      verdict: "request_changes",
      summary: "Still broken",
      findings: [{ severity: "blocking", category: "code_quality", message: "nope" }],
    });
    expect(updated.status).toBe("waiting_on_you");
    expect(env.gh.repo("acme/app").requestedReviewers.get(31)).toEqual({ users: ["alice"], teams: [] });
    expect(env.notifier.sent.map((n) => n.event)).toContain("handover");
  });

  it("resumes a lost runner's pr_review job at pr_review", async () => {
    const { team, repo } = await seedTeam(env, { policyYaml: "auto_pr_review: true\n" });
    const runner = await seedRunner(env, team.id, repo.id, { name: "mac" });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Lost during review",
        harness: "claude-code",
        branch: "foundry/lost-review",
        status: "pr_review",
        runnerId: runner.id,
        lastCompletedStage: "verifying",
        prNumber: 9,
        headSha: "sha-9",
      })
      .returning();
    env.clock.advance(3 * 60_000);
    expect(await requeueLostJobs(env.ctx)).toEqual([job!.id]);
    expect(await getJob(env.ctx, job!.id)).toMatchObject({
      status: "queued",
      resumeStage: "pr_review",
    });
  });

  it("moves a queued review job to implementing when a human message arrives", async () => {
    const { team, repo } = await seedTeam(env, { policyYaml: "auto_pr_review: true\n" });
    const runner = await seedRunner(env, team.id, repo.id, { name: "mac" });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Message during review",
        harness: "claude-code",
        branch: "foundry/msg-review",
        status: "queued",
        resumeStage: "pr_review",
        prNumber: 12,
        headSha: "sha-12",
      })
      .returning();
    const moved = await sendMessage(env.ctx, job!.id, "Please also update the README", "alice");
    expect(moved).toMatchObject({ status: "queued", resumeStage: "implementing" });
    const claimed = (await claimJob(env.ctx, runner))!;
    expect(claimed.resumeStage).toBe("implementing");
    expect(claimed.pendingInputs).toMatchObject([{ kind: "message", text: "Please also update the README" }]);
  });

  it("does not consume pending input on a review claim", async () => {
    const { team, repo } = await seedTeam(env, { policyYaml: "auto_pr_review: true\n" });
    const runner = await seedRunner(env, team.id, repo.id, { name: "mac" });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Stranded input",
        harness: "claude-code",
        branch: "foundry/stranded",
        status: "queued",
        resumeStage: "pr_review",
        prNumber: 13,
        headSha: "sha-13",
      })
      .returning();
    await addInput(env.ctx, job!, { kind: "message", text: "For the next run", by: "alice" });
    const claimed = (await claimJob(env.ctx, runner))!;
    expect(claimed.resumeStage).toBe("pr_review");
    expect(claimed.pendingInputs).toEqual([]);
    expect(await takePendingInputs(env.ctx, job!.id)).toMatchObject([
      { kind: "message", text: "For the next run", by: "alice" },
    ]);
  });

  it("resets the automatic review budget on retry", async () => {
    const { team, repo } = await seedTeam(env, { policyYaml: "auto_pr_review: true\n" });
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Retry review budget",
        harness: "claude-code",
        branch: "foundry/retry-budget",
        status: "waiting_on_you",
        prReviewCount: 2,
        prReviewSha: "sha-old",
      })
      .returning();
    const retried = await retryJob(env.ctx, job!.id, "triage", "alice");
    expect(retried).toMatchObject({ status: "queued", prReviewCount: 0, prReviewSha: null });
  });

  it("never auto-merges after a passing automatic PR review", async () => {
    const { team, repo } = await seedTeam(env, {
      policyYaml: "auto_pr_review: true\nmerge: merge_when_confident\n",
    });
    const runner = await seedRunner(env, team.id, repo.id, { name: "mac", os: "macos" });
    const fake = env.gh.repo("acme/app");
    env.gh.addIssue("acme/app", { number: 21, title: "Review then human merge" });
    await deliver(env, "issues", issueLabeledPayload({ number: 21, title: "Review then human merge" }));
    const c = (await claimJob(env.ctx, runner))!;
    for (const [to, last] of [
      ["investigating", "triage"],
      ["implementing", "investigating"],
      ["reviewing", "implementing"],
      ["verifying", "reviewing"],
    ] as const) {
      await runnerStage(env.ctx, runner, c.id, { to, lastCompletedStage: last });
    }
    for (const name of ["test", "lint"])
      await runnerEvidence(env.ctx, runner, c.id, { kind: "check", name, status: "passed" });
    await runnerEvidence(env.ctx, runner, c.id, { kind: "review", name: "code review", status: "passed" });
    await runnerConfidence(env.ctx, runner, c.id, { level: "high", reasons: ["ok"], uncertainties: [] });
    fake.branches.set(c.branch, "sha-21");
    fake.ci.set("sha-21", "success");
    const pr = await openPullRequest(env.ctx, await getJob(env.ctx, c.id), {
      title: "Review then human merge",
      summary: "Done",
      headSha: "sha-21",
      uiChanged: false,
      changedLines: 10,
    });
    fake.prFiles.set(pr.prNumber, [{ filename: "src/a.ts", additions: 5, deletions: 1 }]);
    // The gate is held while the review is still outstanding, even though CI is green.
    expect((await getJob(env.ctx, c.id)).status).toBe("queued");
    expect((await getJob(env.ctx, c.id)).resumeStage).toBe("pr_review");

    await claimJob(env.ctx, runner);
    const result = await runnerPrReview(env.ctx, runner, c.id, {
      verdict: "approve",
      summary: "No blocking issues",
      findings: [],
    });
    expect(result.status).toBe("waiting_on_you");
    const handed = await getJob(env.ctx, c.id);
    expect(handed.gateResult).toMatchObject({
      pass: false,
      pending: false,
      failed: [{ rule: "human_review" }],
    });
    expect(fake.prs.get(pr.prNumber)?.merged).toBe(false);
    expect(env.gh.reviewsOn("acme/app", pr.prNumber)[0]).toMatchObject({ state: "COMMENTED" });
  });

  it("re-queues a job for a changes-requested review even when the webhook was missed", async () => {
    const { team, repo } = await seedTeam(env);
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Fix login",
        harness: "claude-code",
        branch: "foundry/fix-login",
        status: "waiting_on_you",
        prNumber: 5,
        prUrl: "https://github.com/acme/app/pull/5",
      })
      .returning();
    const gh = env.gh.repo("acme/app");
    gh.reviews.set(5, [
      { id: 101, author: "carol", state: "COMMENTED", body: "Looks close" },
      { id: 102, author: "carol", state: "CHANGES_REQUESTED", body: "Use a reversible migration" },
      { id: 103, author: "bugbot[bot]", state: "CHANGES_REQUESTED", body: "Bot nit" },
    ]);

    expect(await reconcileChangesRequestedReviews(env.ctx)).toEqual([job!.id]);
    expect(await getJob(env.ctx, job!.id)).toMatchObject({
      status: "queued",
      resumeStage: "implementing",
      lastReviewId: 102,
    });
    // The same review is not forwarded to the agent twice.
    expect(await reconcileChangesRequestedReviews(env.ctx)).toEqual([]);
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

  it("marks a handed-over job merged when GitHub already merged the PR, even without a webhook", async () => {
    const { repo } = await seedTeam(env);
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: repo.teamId,
        repoId: repo.id,
        kind: "onboarding",
        title: "Set up Foundry for acme/app",
        harness: "claude-code",
        branch: "foundry/onboarding-x",
        status: "waiting_on_you",
        prNumber: 1,
        prUrl: "https://github.com/acme/app/pull/1",
        prTitle: "Set up Foundry",
      })
      .returning();
    const gh = env.gh.repo("acme/app");
    gh.prs.set(1, {
      number: 1,
      url: "https://github.com/acme/app/pull/1",
      headSha: "sha-1",
      state: "closed",
      merged: true,
      head: "foundry/onboarding-x",
      base: "main",
      title: "Set up Foundry",
      body: "",
    });
    gh.files.set(".foundry/recipe.yaml", TEST_RECIPE);
    gh.files.set(".foundry/policy.yaml", "merge: off\n");
    await env.ctx.db
      .update(repos)
      .set({ acceptsJobs: false, onboardingStatus: "pr_open", recipeSha: null, recipeYaml: null })
      .where(eq(repos.id, repo.id));

    expect(await reconcileOpenPullRequests(env.ctx)).toEqual([job!.id]);
    expect(await getJob(env.ctx, job!.id)).toMatchObject({ status: "merged" });
    const updated = await env.ctx.db.query.repos.findFirst({ where: eq(repos.id, repo.id) });
    expect(updated).toMatchObject({ acceptsJobs: true, onboardingStatus: "done" });
  });

  it("does not re-create a cancelled job whose trigger label lingers, and retries it in place", async () => {
    const { team, repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 9, title: "Cancel then retry", labels: ["foundry"] });
    await deliver(env, "issues", issueLabeledPayload({ number: 9, title: "Cancel then retry" }));
    const [job] = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });

    await cancelJob(env.ctx, job!.id, "alice");
    env.clock.advance(1000);
    // The issue still carries the `foundry` label; the catch-up must not start a second job.
    expect(await reconcileLabeledIssues(env.ctx)).toEqual([]);
    expect(await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) })).toHaveLength(1);

    // Removing and re-adding the label delivers `issues.labeled` again: that is a retry of the
    // same job, so the board moves its one card back instead of showing the issue twice.
    await deliver(env, "issues", issueLabeledPayload({ number: 9, title: "Cancel then retry" }));
    const rows = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: job!.id, status: "queued" });

    const board = await boardJobs(env.ctx, team.id);
    expect(board.map((b) => b.job.id)).toEqual([job!.id]);
    expect(board[0]?.job.status).toBe("queued");

    expect(await retryJob(env.ctx, job!.id, "triage", "alice")).toMatchObject({
      id: job!.id,
      status: "queued",
    });
  });

  it("re-reads the repo harness and model on retry so a harness fix applies in place", async () => {
    const { repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 11, title: "Fix the harness", labels: ["foundry"] });
    await deliver(env, "issues", issueLabeledPayload({ number: 11, title: "Fix the harness" }));
    const [job] = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    await env.ctx.db
      .update(jobs)
      .set({
        status: "failed",
        harness: "opencode",
        model: "deepseek-flash",
        harnessSessionId: "ses-old",
      })
      .where(eq(jobs.id, job!.id));
    await env.ctx.db
      .update(repos)
      .set({ defaultHarness: "claude-code", defaultModel: "deepseek-flash[1m]" })
      .where(eq(repos.id, repo.id));

    const retried = await retryJob(env.ctx, job!.id, "triage", "alice");
    expect(retried).toMatchObject({
      id: job!.id,
      status: "queued",
      harness: "claude-code",
      model: "deepseek-flash[1m]",
      // The OpenCode session cannot be resumed by Claude Code.
      harnessSessionId: null,
    });
  });

  it("keeps issue harness and model labels when retrying", async () => {
    const { repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", {
      number: 12,
      title: "Pinned to OpenCode",
      labels: ["foundry", "harness:opencode", "model:openai/gpt-5.4"],
    });
    await deliver(
      env,
      "issues",
      issueLabeledPayload({
        number: 12,
        title: "Pinned to OpenCode",
        labels: ["foundry", "harness:opencode", "model:openai/gpt-5.4"],
      }),
    );
    const [job] = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    await env.ctx.db
      .update(jobs)
      .set({ status: "failed", failureReason: "harness error" })
      .where(eq(jobs.id, job!.id));
    await env.ctx.db
      .update(repos)
      .set({ defaultHarness: "claude-code", defaultModel: "claude-sonnet-4-5" })
      .where(eq(repos.id, repo.id));

    expect(await retryJob(env.ctx, job!.id, "triage", "alice")).toMatchObject({
      harness: "opencode",
      model: "openai/gpt-5.4",
    });
  });

  it("revives a failed job in place when the trigger label is re-applied", async () => {
    const { repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 10, title: "Fail then relabel", labels: ["foundry"] });
    await deliver(env, "issues", issueLabeledPayload({ number: 10, title: "Fail then relabel" }));
    const [job] = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    await env.ctx.db.update(jobs).set({ status: "failed" }).where(eq(jobs.id, job!.id));

    await deliver(env, "issues", issueLabeledPayload({ number: 10, title: "Fail then relabel" }));
    const rows = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: job!.id, status: "queued" });
  });

  it("creates a ticket job for an open foundry-labeled issue when the webhook was missed", async () => {
    const { repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", {
      number: 2,
      title: "Add pnpm lint",
      body: "### Goal\n\nLint\n",
      labels: ["foundry"],
    });
    expect(await reconcileLabeledIssues(env.ctx)).toHaveLength(1);
    const rows = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "ticket",
      issueNumber: 2,
      title: "Add pnpm lint",
      status: "queued",
    });
    expect(await reconcileLabeledIssues(env.ctx)).toEqual([]);
  });

  it("returns the recipe PR and every runner's readiness for a repo", async () => {
    const { team, repo } = await seedTeam(env);
    await seedRunner(env, team.id, repo.id, { name: "ready-mbp" });
    const broken = await seedRunner(env, team.id, repo.id, { name: "broken-mbp" });
    await env.ctx.db
      .update(runnerRepoReadiness)
      .set({ ready: false, reason: "pnpm test failed" })
      .where(eq(runnerRepoReadiness.runnerId, broken.id));
    await env.ctx.db.insert(jobs).values({
      teamId: team.id,
      repoId: repo.id,
      kind: "onboarding",
      title: "Set up Foundry for acme/app",
      harness: "claude-code",
      branch: "foundry/onboarding-12345678",
      prUrl: "https://github.com/acme/app/pull/12",
    });

    const [withReadiness] = await teamReposWithReadiness(env.ctx, team.id);
    expect(withReadiness?.repo.id).toBe(repo.id);
    expect(withReadiness?.recipePrUrl).toBe("https://github.com/acme/app/pull/12");
    expect(withReadiness?.readiness).toEqual([
      expect.objectContaining({ runnerName: "broken-mbp", ready: false, reason: "pnpm test failed" }),
      expect.objectContaining({ runnerName: "ready-mbp", ready: true }),
    ]);
  });
});
