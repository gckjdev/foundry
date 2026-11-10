import { jobs } from "@foundry/db";
import { describe, expect, it } from "vitest";
import { boardJobs, inbox } from "./queries";
import { createSqliteTestEnv, seedTeam } from "./testing";

describe("queries (sqlite)", () => {
  it("boardJobs and inbox return a job created against sqlite", async () => {
    const env = await createSqliteTestEnv();
    try {
      const { ctx } = env;
      const { team, alice, repo } = await seedTeam(env);
      await ctx.db.insert(jobs).values({
        teamId: team.id,
        repoId: repo.id,
        title: "Fix",
        harness: "claude-code",
        branch: "foundry/x",
        authorUserId: alice.id,
        authorLogin: "alice",
      });

      const board = await boardJobs(ctx, team.id);
      expect(board).toHaveLength(1);
      expect(board[0]!.job.title).toBe("Fix");
      expect(board[0]!.repoFullName).toBe("acme/app");

      const box = await inbox(ctx, team.id, alice.id);
      expect(box.mine).toHaveLength(1);
      expect(box.mine[0]!.title).toBe("Fix");
    } finally {
      await env.drop();
    }
  });
});
