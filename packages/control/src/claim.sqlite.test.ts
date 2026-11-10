import { jobs, runners } from "@foundry/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { claimJob } from "./claim";
import { createSqliteTestEnv, seedRunner, seedTeam } from "./testing";

describe("claim (sqlite)", () => {
  it("two concurrent claimJob calls hand the job to exactly one runner", async () => {
    const env = await createSqliteTestEnv();
    try {
      const { ctx } = env;
      const { team, repo } = await seedTeam(env);
      await seedRunner(env, team.id, repo.id, { name: "runner-a" });
      await seedRunner(env, team.id, repo.id, { name: "runner-b" });
      await ctx.db.insert(jobs).values({
        teamId: team.id,
        repoId: repo.id,
        title: "Fix",
        harness: "claude-code",
        branch: "foundry/x",
      });

      const runnerA = (await ctx.db.query.runners.findFirst({ where: eq(runners.name, "runner-a") }))!;
      const runnerB = (await ctx.db.query.runners.findFirst({ where: eq(runners.name, "runner-b") }))!;
      const [a, b] = await Promise.all([claimJob(ctx, runnerA), claimJob(ctx, runnerB)]);
      expect([a, b].filter(Boolean)).toHaveLength(1);

      const claimed = await ctx.db.query.jobs.findFirst({ where: eq(jobs.teamId, team.id) });
      expect(claimed!.status).not.toBe("queued");
      expect([runnerA.id, runnerB.id]).toContain(claimed!.runnerId);
    } finally {
      await env.drop();
    }
  });
});
