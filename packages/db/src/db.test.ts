import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobs, repos, teams } from "./index";
import { createTestDatabase, TEST_DATABASE_URL } from "./testing";

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe.skipIf(!TEST_DATABASE_URL)("db", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("notifies job changes with the changed columns", async () => {
    const received: unknown[] = [];
    const listener = await t.sql.listen("foundry_changes", (p) => received.push(JSON.parse(p)));
    const [team] = await t.db.insert(teams).values({ name: "acme" }).returning();
    const [repo] = await t.db
      .insert(repos)
      .values({ teamId: team!.id, ghInstallationId: 1, ghRepoId: 10, fullName: "acme/app" })
      .returning();
    const [job] = await t.db
      .insert(jobs)
      .values({
        teamId: team!.id,
        repoId: repo!.id,
        title: "Fix",
        harness: "claude-code",
        branch: "foundry/x",
      })
      .returning();
    await until(() => received.length > 0);
    expect(received).toContainEqual({
      table: "jobs",
      id: job!.id,
      team_id: team!.id,
      op: "INSERT",
      columns: [],
    });

    // A cost-only update (as `recordEvents` does every flush) reports cosmetic columns, not status.
    await t.db.update(jobs).set({ costUsd: 1.25 }).where(eq(jobs.id, job!.id));
    await until(() => received.length >= 2);
    const costMsg = received.at(-1) as { op: string; columns: string[] };
    expect(costMsg.op).toBe("UPDATE");
    expect(costMsg.columns).toContain("cost_usd");
    expect(costMsg.columns).not.toContain("status");

    // A status transition reports `status`.
    await t.db.update(jobs).set({ status: "investigating" }).where(eq(jobs.id, job!.id));
    await until(() => received.length >= 3);
    const statusMsg = received.at(-1) as { op: string; columns: string[] };
    expect(statusMsg.op).toBe("UPDATE");
    expect(statusMsg.columns).toContain("status");

    await listener.unlisten();
  });
});
