import { events, jobs } from "@foundry/db";
import { describe, expect, it } from "vitest";
import { capacityCard, teamMetrics } from "./metrics";
import { createSqliteTestEnv, seedTeam } from "./testing";

describe("metrics (sqlite)", () => {
  it("computes metrics without the Postgres views", async () => {
    const env = await createSqliteTestEnv();
    try {
      const { ctx } = env;
      const { team } = await seedTeam(env);
      const m = await teamMetrics(ctx, { teamId: team.id, days: 30 });
      expect(m.jobs).toBe(0);
      expect(m.weeklyActiveFilers.members).toBe(1);
      expect(m.byOs).toEqual([]);
      expect(m.byHarness).toEqual([]);
      expect(m.runnerUtilization).toEqual([]);
    } finally {
      await env.drop();
    }
  });

  it("computes the capacity card without window functions", async () => {
    const env = await createSqliteTestEnv();
    try {
      const { ctx } = env;
      const { team, repo } = await seedTeam(env);
      const now = ctx.now().getTime();
      const [job] = await ctx.db
        .insert(jobs)
        .values({
          teamId: team.id,
          repoId: repo.id,
          title: "Fix",
          harness: "claude-code",
          branch: "foundry/c",
        })
        .returning();
      await ctx.db.insert(events).values([
        {
          jobId: job!.id,
          teamId: team.id,
          kind: "stage_changed",
          ts: new Date(now - 5 * 3600_000),
          payload: { kind: "stage_changed", to: "queued" },
        },
        {
          jobId: job!.id,
          teamId: team.id,
          kind: "stage_changed",
          ts: new Date(now - 4 * 3600_000),
          payload: { kind: "stage_changed", from: "queued", to: "running" },
        },
      ]);

      const card = await capacityCard(ctx, team.id, 7);
      expect(card.hoursNoOnlineRunner).toBeCloseTo(1, 1);
      expect(card.hoursQueueWithNoRunner).toBeCloseTo(1, 1);
      expect(card.estimatedHoursSavedBySharedRunner).toBeCloseTo(1, 1);
    } finally {
      await env.drop();
    }
  });
});
