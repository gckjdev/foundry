import type { AddressInfo } from "node:net";
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
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("realtime server", () => {
  let rt: RealtimeServer;
  afterEach(async () => {
    await rt?.close();
  });

  it("rejects bad tokens and fans changes out per team", async () => {
    rt = await startRealtime({ sql: null, secret: SECRET, port: 0 });
    const port = (rt.server.address() as AddressInfo).port;
    await expect(connect(`ws://localhost:${port}/?token=nope`)).rejects.toThrow();

    const a = await connect(`ws://localhost:${port}/?token=${token("team-a")}`);
    const b = await connect(`ws://localhost:${port}/`, ["foundry", token("team-b")]);
    await until(() => a.messages.length > 0 && b.messages.length > 0);
    expect(
      rt.broadcast({ table: "jobs", id: "j1", team_id: "team-a", op: "UPDATE", columns: ["status"] }),
    ).toBe(1);
    await until(() => a.messages.length > 1);
    expect(a.messages.at(-1)).toEqual({
      type: "change",
      table: "jobs",
      id: "j1",
      op: "UPDATE",
      columns: ["status"],
    });
    expect(b.messages).toHaveLength(1);
    a.ws.close();
    b.ws.close();
  });
});
