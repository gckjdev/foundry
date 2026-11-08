import { jobs } from "@foundry/db";
import { TEST_DATABASE_URL } from "@foundry/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cancelJob, reconcileLabeledIssues, retryJob } from "./jobs";
import { boardJobs } from "./queries";
import { createTestEnv, seedTeam, type TestEnv } from "./testing";

describe.skipIf(!TEST_DATABASE_URL)("repro", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(async () => {
    await env.drop();
  });

  it("cancel then retry", async () => {
    const { team, repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 7, title: "Fix login", labels: ["foundry"] });
    await reconcileLabeledIssues(env.ctx);
    const [a] = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    console.log("created", a!.id, a!.status);

    await cancelJob(env.ctx, a!.id, "alice");
    env.clock.advance(1000);
    console.log("after cancel label", (await env.gh.getIssue({ installationId: 1, fullName: "acme/app" }, 7)).labels);
    const afterCancelBoard = await boardJobs(env.ctx, team.id);
    const allAfterCancel = await env.ctx.db.query.jobs.findMany({ orderBy: asc(jobs.createdAt) });
    console.log(
      "after cancel: jobs",
      allAfterCancel.map((j) => ({ id: j.id, status: j.status })),
      "board",
      afterCancelBoard.map((r) => ({ id: r.job.id, status: r.job.status })),
    );

    await retryJob(env.ctx, a!.id, "triage", "alice").catch((e) => console.log("retry error", String(e)));
    const afterRetry = await env.ctx.db.query.jobs.findMany({ orderBy: asc(jobs.createdAt) });
    console.log("after retry jobs", afterRetry.map((j) => ({ id: j.id, status: j.status })));
    const board = await boardJobs(env.ctx, team.id);
    console.log("final board", board.map((r) => ({ id: r.job.id, status: r.job.status })));
    expect(board).toHaveLength(1);
  });

  it("cancel then reconcile then retry", async () => {
    const { team, repo } = await seedTeam(env);
    env.gh.addIssue("acme/app", { number: 8, title: "Fix other", labels: ["foundry"] });
    await reconcileLabeledIssues(env.ctx);
    const [a] = await env.ctx.db.query.jobs.findMany({ where: eq(jobs.repoId, repo.id) });
    await cancelJob(env.ctx, a!.id, "alice");
    env.clock.advance(1000);
    // board load runs reconcile
    const board = await boardJobs(env.ctx, team.id);
    console.log("board after cancel", board.map((r) => ({ id: r.job.id, status: r.job.status })));
    const retried = await retryJob(env.ctx, a!.id, "triage", "alice").catch((e) => {
      console.log("retry error", String(e));
      return null;
    });
    console.log("retried", retried?.status);
    const board2 = await boardJobs(env.ctx, team.id);
    console.log("board after retry", board2.map((r) => ({ id: r.job.id, status: r.job.status })));
    expect(board2).toHaveLength(1);
  });
});
