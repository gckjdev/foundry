import type { AddressInfo } from "node:net";
import { jobs, repos, teams } from "@foundry/db";
import { createSqliteTestDatabase } from "@foundry/db/testing";
import { signToken } from "@foundry/shared";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { type RealtimeServer, startRealtime } from "./server";

const SECRET = "rt-secret";
const token = (teamId: string) =>
  signToken({ teamId, sub: "u1", kind: "user", exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);

function connect(url: string, protocols?: string[]): Promise<{ ws: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols);
    const messages: unknown[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("error", reject);
  });
}

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("realtime sqlite polling", () => {
  let rt: RealtimeServer;
  let db: Awaited<ReturnType<typeof createSqliteTestDatabase>>;

  afterEach(async () => {
    await rt?.close();
    await db?.drop();
  });

  it("polls _foundry_changes and broadcasts jobs changes to the team", async () => {
    db = await createSqliteTestDatabase();
    const [team] = await db.db.insert(teams).values({ name: "rt" }).returning();

    rt = await startRealtime({ sql: null, sqlite: db.sqlite, secret: SECRET, port: 0, pollIntervalMs: 20 });
    const port = (rt.server.address() as AddressInfo).port;
    const a = await connect(`ws://localhost:${port}/?token=${token(team!.id)}`);
    await until(() => a.messages.length > 0); // hello

    const [repo] = await db.db
      .insert(repos)
      .values({ teamId: team!.id, ghInstallationId: 1, ghRepoId: 99, fullName: "rt/app" })
      .returning();
    await db.db.insert(jobs).values({
      teamId: team!.id,
      repoId: repo!.id,
      title: "Fix",
      harness: "claude-code",
      branch: "foundry/x",
    });

    await until(() => a.messages.some((m) => (m as { type: string }).type === "change"));
    expect(a.messages).toContainEqual({
      type: "change",
      table: "jobs",
      id: expect.any(String),
      op: "INSERT",
      columns: [],
    });
    a.ws.close();
  });

  it("broadcasts the changed column names for a jobs update", async () => {
    db = await createSqliteTestDatabase();
    const [team] = await db.db.insert(teams).values({ name: "rt" }).returning();

    rt = await startRealtime({ sql: null, sqlite: db.sqlite, secret: SECRET, port: 0, pollIntervalMs: 20 });
    const port = (rt.server.address() as AddressInfo).port;
    const a = await connect(`ws://localhost:${port}/?token=${token(team!.id)}`);
    await until(() => a.messages.length > 0); // hello

    const [repo] = await db.db
      .insert(repos)
      .values({ teamId: team!.id, ghInstallationId: 1, ghRepoId: 98, fullName: "rt/app" })
      .returning();
    const [job] = await db.db
      .insert(jobs)
      .values({
        teamId: team!.id,
        repoId: repo!.id,
        title: "Fix",
        harness: "claude-code",
        branch: "foundry/x",
      })
      .returning();

    await db.sqlite!.execute("update jobs set title = ? where id = ?", ["Fix 2", job!.id]);

    await until(() =>
      a.messages.some(
        (m) =>
          (m as { type: string; op?: string; columns?: string[] }).type === "change" &&
          (m as { op?: string }).op === "UPDATE",
      ),
    );
    const update = a.messages.find(
      (m) => (m as { type: string; op?: string }).type === "change" && (m as { op?: string }).op === "UPDATE",
    ) as { columns: string[] };
    expect(update.columns).toContain("title");
    a.ws.close();
  });
});
