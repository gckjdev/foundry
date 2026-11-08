import { describe, expect, it } from "vitest";
import { teamMetrics } from "./metrics";
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
});
