import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobs, repos, teams } from "./index";
import { createTestDatabase, TEST_DATABASE_URL } from "./testing";

describe.skipIf(!TEST_DATABASE_URL)("db", () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("notifies job changes with id and team only", async () => {
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
    for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(received).toContainEqual({ table: "jobs", id: job!.id, team_id: team!.id, op: "INSERT" });
    await listener.unlisten();
  });
});
