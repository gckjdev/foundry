import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobs, questions, repos, teams, users } from "@foundry/db";
import { TEST_DATABASE_URL } from "@foundry/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactUrl, readArtifact, storeArtifact } from "./artifacts";
import { NotFoundError, recordEvents } from "./jobs";
import { teamMetrics } from "./metrics";
import { ChannelNotifier, sendDigests } from "./notify";
import { completeOnboarding, startOnboarding } from "./onboarding";
import { boardJobs, eventsSince, inbox, jobDetail, runningJobsByRunner, teamRepos } from "./queries";
import { createTestEnv, seedTeam, type TestEnv } from "./testing";
import { startWorker } from "./worker";

describe.skipIf(!TEST_DATABASE_URL)("panel and side-effect surfaces", () => {
  let env: TestEnv;
  let prevArtifacts: string | undefined;

  beforeEach(async () => {
    prevArtifacts = process.env.ARTIFACTS_DIR;
    process.env.ARTIFACTS_DIR = mkdtempSync(join(tmpdir(), "foundry-art-"));
    env = await createTestEnv();
  });

  afterEach(async () => {
    if (prevArtifacts === undefined) delete process.env.ARTIFACTS_DIR;
    else process.env.ARTIFACTS_DIR = prevArtifacts;
    await env.drop();
  });

  async function ticket(
    repoId: string,
    teamId: string,
    authorId: string,
    extra: Record<string, unknown> = {},
  ) {
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId,
        repoId,
        title: "Cover the inbox",
        harness: "claude-code",
        branch: `foundry/${crypto.randomUUID().slice(0, 8)}`,
        authorLogin: "alice",
        authorUserId: authorId,
        ...extra,
      })
      .returning();
    return job!;
  }

  it("lists board, inbox, repos, and a job timeline", async () => {
    const { team, alice, repo } = await seedTeam(env);
    const queued = await ticket(repo.id, team.id, alice.id);
    const review = await ticket(repo.id, team.id, alice.id, {
      status: "waiting_on_you",
      assignedReviewers: ["Alice"],
    });
    const loose = await ticket(repo.id, team.id, alice.id, {
      status: "waiting_on_you",
      assignedReviewers: [],
    });
    await env.ctx.db.insert(questions).values({
      jobId: queued.id,
      teamId: team.id,
      askedLogin: "alice",
      prompt: "Which file?",
    });
    await recordEvents(env.ctx, queued, [{ kind: "message", role: "system", text: "queued" }]);

    const board = await boardJobs(env.ctx, team.id);
    expect(board.map((b) => b.job.id)).toEqual(expect.arrayContaining([queued.id, review.id, loose.id]));
    expect(board.find((b) => b.job.id === queued.id)?.repoFullName).toBe("acme/app");

    const box = await inbox(env.ctx, team.id, alice.id);
    expect(box.questions).toHaveLength(1);
    expect(box.reviews.map((j) => j.id)).toEqual([review.id]);
    expect(box.unassigned.map((j) => j.id)).toContain(loose.id);
    expect(box.mine.map((j) => j.id)).toEqual(expect.arrayContaining([queued.id]));
    expect(await inbox(env.ctx, team.id, crypto.randomUUID())).toEqual({
      questions: [],
      reviews: [],
      mine: [],
      unassigned: [],
      blocked: [],
    });

    const detail = await jobDetail(env.ctx, team.id, queued.id);
    expect(detail?.timeline).toHaveLength(1);
    expect(detail?.questions).toHaveLength(1);
    expect(await jobDetail(env.ctx, team.id, crypto.randomUUID())).toBeNull();

    const after = detail!.timeline[0]!.id;
    expect(await eventsSince(env.ctx, team.id, queued.id, after)).toEqual([]);
    expect(await teamRepos(env.ctx, team.id)).toHaveLength(1);
    expect(await runningJobsByRunner(env.ctx, [])).toEqual([]);
    expect(await runningJobsByRunner(env.ctx, [crypto.randomUUID()])).toEqual([]);
  });

  it("shows one card per issue on the board", async () => {
    const { team, alice, repo } = await seedTeam(env);
    const cancelled = await ticket(repo.id, team.id, alice.id, {
      issueNumber: 7,
      status: "cancelled",
      title: "Cancelled job",
    });
    const live = await ticket(repo.id, team.id, alice.id, {
      issueNumber: 7,
      status: "queued",
      title: "Retried job",
    });

    const board = await boardJobs(env.ctx, team.id);
    expect(board.map((b) => b.job.id)).toEqual([live.id]);
    expect(board.find((b) => b.job.id === cancelled.id)).toBeUndefined();
  });

  it("stores an artifact and rejects a bad token", async () => {
    const { team } = await seedTeam(env);
    const row = await storeArtifact(env.ctx, {
      teamId: team.id,
      jobId: null,
      name: "shot / one.png",
      contentType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(row.name).toBe("shot_one.png");
    const url = artifactUrl(env.ctx, row.id);
    const token = new URL(url).searchParams.get("t")!;
    const read = await readArtifact(env.ctx, row.id, token);
    expect(read?.bytes).toEqual(Buffer.from([1, 2, 3]));
    expect(await readArtifact(env.ctx, row.id, "nope")).toBeNull();
    expect(await readArtifact(env.ctx, crypto.randomUUID(), token)).toBeNull();
  });

  it("starts, restarts, and fails onboarding", async () => {
    const { repo } = await seedTeam(env);
    await expect(startOnboarding(env.ctx, crypto.randomUUID(), "alice")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const first = await startOnboarding(env.ctx, repo.id, "alice");
    expect(await startOnboarding(env.ctx, repo.id, "alice")).toMatchObject({ id: first.id });
    const restarted = await startOnboarding(env.ctx, repo.id, "alice", { restart: true });
    expect(restarted.id).not.toBe(first.id);
    expect(await env.ctx.db.query.jobs.findFirst({ where: eq(jobs.id, first.id) })).toMatchObject({
      status: "cancelled",
    });

    await env.ctx.db.update(jobs).set({ status: "verifying" }).where(eq(jobs.id, restarted.id));
    const verifying = (await env.ctx.db.query.jobs.findFirst({ where: eq(jobs.id, restarted.id) }))!;
    expect(
      await completeOnboarding(env.ctx, verifying, { ok: false, reason: null, headSha: null, summary: "" }),
    ).toBeNull();
    expect(await env.ctx.db.query.repos.findFirst({ where: eq(repos.id, repo.id) })).toMatchObject({
      onboardingStatus: "failed",
    });

    const again = await startOnboarding(env.ctx, repo.id, "alice");
    const pr = await completeOnboarding(env.ctx, again, {
      ok: true,
      reason: null,
      headSha: "abc",
      summary: "recipe",
    });
    expect(pr?.prNumber).toBeGreaterThan(0);
    expect(await env.ctx.db.query.repos.findFirst({ where: eq(repos.id, repo.id) })).toMatchObject({
      onboardingStatus: "pr_open",
    });
  });

  it("computes empty-team metrics", async () => {
    const { team, repo } = await seedTeam(env);
    const metrics = await teamMetrics(env.ctx, { teamId: team.id, days: 7, repoId: repo.id });
    expect(metrics.jobs).toBe(0);
    expect(metrics.weeklyActiveFilers.members).toBe(1);
    expect(metrics.ticketToPrRate).toBeNull();
    expect(metrics.byOs).toEqual([]);
    expect(metrics.byHarness).toEqual([]);
    expect(metrics.runnerUtilization).toEqual([]);
  });

  it("delivers email, push, digest, and webhook notifications", async () => {
    const { team, alice, repo } = await seedTeam(env);
    const [bob] = await env.ctx.db
      .insert(users)
      .values({ ghLogin: "bob", email: "bob@acme.test", notifyPref: "digest" })
      .returning();
    await env.ctx.db.update(users).set({ notifyPref: "email" }).where(eq(users.id, alice.id));
    await env.ctx.db
      .update(teams)
      .set({ outgoingWebhookUrl: "https://hooks.example/foundry" })
      .where(eq(teams.id, team.id));
    const job = await ticket(repo.id, team.id, alice.id);
    const emails: string[] = [];
    const pushes: string[] = [];
    const hooks: string[] = [];
    const notifier = new ChannelNotifier({
      sendEmail: async (to) => {
        emails.push(to);
      },
      sendPush: async () => {
        pushes.push("sent");
        throw new Error("push down");
      },
      postWebhook: async (url) => {
        hooks.push(url);
      },
    });
    await notifier.notify(env.ctx, { event: "failed", job, detail: "checks" });
    expect(emails).toEqual(["alice@acme.test"]);
    expect(hooks).toEqual(["https://hooks.example/foundry"]);

    await env.ctx.db
      .update(users)
      .set({ notifyPref: "push", pushSubscription: { endpoint: "https://push.example" } })
      .where(eq(users.id, alice.id));
    await notifier.notify(env.ctx, { event: "failed", job, detail: "again" });
    expect(pushes).toEqual(["sent"]);

    await notifier.notify(env.ctx, {
      event: "handover",
      job: { ...job, authorLogin: "bob", assignedReviewers: ["bob"] },
      detail: "review",
    });
    expect(await sendDigests(env.ctx, {})).toBe(0);
    expect(
      await sendDigests(env.ctx, {
        sendEmail: async (to, subject) => {
          expect(to).toBe("bob@acme.test");
          expect(subject).toContain("digest");
        },
      }),
    ).toBe(1);
    expect(bob?.id).toBeTruthy();
  });

  it("runs one worker tick and stops", async () => {
    await seedTeam(env);
    const lines: string[] = [];
    env.ctx.log = (message) => lines.push(message);
    const stop = startWorker(env.ctx, {}, { digestHour: 24 });
    await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(lines.some((l) => l.includes("worker tick failed"))).toBe(false);
  });
});
