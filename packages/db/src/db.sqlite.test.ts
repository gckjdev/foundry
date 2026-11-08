import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events, jobs, repos, teams } from "./index";
import { createSqliteTestDatabase } from "./testing";

describe("sqlite driver", () => {
  let t: Awaited<ReturnType<typeof createSqliteTestDatabase>>;

  beforeAll(async () => {
    t = await createSqliteTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("migrates and round-trips booleans, timestamps, and json", async () => {
    expect(t.dialect).toBe("sqlite");
    expect(t.sql).toBeNull();
    expect(t.sqlite).not.toBeNull();

    const [team] = await t.db.insert(teams).values({ name: "acme" }).returning();
    const [repo] = await t.db
      .insert(repos)
      .values({
        teamId: team!.id,
        ghInstallationId: 1,
        ghRepoId: 10,
        fullName: "acme/app",
        acceptsJobs: true,
      })
      .returning();
    expect(repo!.acceptsJobs).toBe(true);

    const [job] = await t.db
      .insert(jobs)
      .values({
        teamId: team!.id,
        repoId: repo!.id,
        title: "Fix",
        harness: "claude-code",
        branch: "foundry/x",
        confidence: { level: "high" },
      })
      .returning();
    expect(job!.confidence).toEqual({ level: "high" });
    expect(job!.createdAt).toBeInstanceOf(Date);

    const [ev] = await t.db
      .insert(events)
      .values({
        jobId: job!.id,
        teamId: team!.id,
        kind: "stage_changed",
        stage: "queued",
        payload: { kind: "stage_changed" },
      })
      .returning();
    expect(typeof ev!.id).toBe("number");
  });

  it("supports async drizzle transactions", async () => {
    const [team] = await t.db.insert(teams).values({ name: "tx" }).returning();
    const updated = await t.db.transaction(async (tx) => {
      await tx.select().from(teams).where(eq(teams.id, team!.id));
      const [row] = await tx
        .update(teams)
        .set({ name: "tx-renamed" })
        .where(eq(teams.id, team!.id))
        .returning();
      return row;
    });
    expect(updated!.name).toBe("tx-renamed");
  });

  it("records jobs changes in the realtime outbox", async () => {
    const [team] = await t.db.insert(teams).values({ name: "outbox" }).returning();
    const [repo] = await t.db
      .insert(repos)
      .values({ teamId: team!.id, ghInstallationId: 1, ghRepoId: 20, fullName: "outbox/app" })
      .returning();
    const [job] = await t.db
      .insert(jobs)
      .values({
        teamId: team!.id,
        repoId: repo!.id,
        title: "Fix",
        harness: "claude-code",
        branch: "foundry/y",
      })
      .returning();
    const rows = await t.sqlite!.execute(
      'select * from _foundry_changes where team_id = ? and "table" = ? order by seq',
      [team!.id, "jobs"],
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.rows[0]).toMatchObject({ table: "jobs", id: job!.id, team_id: team!.id, op: "INSERT" });
  });

  it("records the names of columns changed by a jobs update", async () => {
    const [team] = await t.db.insert(teams).values({ name: "cols" }).returning();
    const [repo] = await t.db
      .insert(repos)
      .values({ teamId: team!.id, ghInstallationId: 1, ghRepoId: 30, fullName: "cols/app" })
      .returning();
    const [job] = await t.db
      .insert(jobs)
      .values({
        teamId: team!.id,
        repoId: repo!.id,
        title: "Fix",
        harness: "claude-code",
        branch: "foundry/z",
      })
      .returning();

    await t.db.update(jobs).set({ title: "Fix 2" }).where(eq(jobs.id, job!.id));

    const rows = await t.sqlite!.execute(
      'select "columns" from _foundry_changes where id = ? and op = ? order by seq',
      [job!.id, "UPDATE"],
    );
    const sets = rows.rows.map((r) => JSON.parse(String(r.columns)) as string[]);
    // The update itself reports the meaningful change; the `jobs_touch` bump reports `updated_at`.
    expect(sets.some((c) => c.includes("title"))).toBe(true);
    expect(sets.some((c) => c.includes("updated_at"))).toBe(true);
  });
});
