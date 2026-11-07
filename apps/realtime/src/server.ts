import { createServer, type IncomingMessage, type Server } from "node:http";
import { type RealtimeClaims, verifyToken } from "@foundry/shared";
import type { Sql } from "postgres";
import { WebSocket, WebSocketServer } from "ws";

export const CHANNEL = "foundry_changes";

export interface ChangeMessage {
  table: string;
  id: string;
  team_id: string;
  op: string;
}

export interface RealtimeServer {
  server: Server;
  /** Fan a change out to every client of its team (also used directly by tests). */
  broadcast(change: ChangeMessage): number;
  clientCount(): number;
  close(): Promise<void>;
}

interface Client {
  ws: WebSocket;
  claims: RealtimeClaims;
  alive: boolean;
}

function tokenFrom(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", "http://localhost");
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const proto = req.headers["sec-websocket-protocol"];
  // Browsers can't set headers on WebSocket; allow `new WebSocket(url, ["foundry", token])`.
  const parts = (Array.isArray(proto) ? proto.join(",") : (proto ?? "")).split(",").map((s) => s.trim());
  return parts.length === 2 && parts[0] === "foundry" ? parts[1]! : null;
}

/**
 * One Postgres LISTEN connection, fanned out to WebSocket clients per team. Messages carry only
 * `{table, id, op}`; clients fetch rows through the authenticated API.
 */
export async function startRealtime(opts: {
  sql: Sql | null;
  secret: string;
  port: number;
}): Promise<RealtimeServer> {
  const clients = new Set<Client>();
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    res.writeHead(426, { "content-type": "text/plain" }).end("WebSocket only");
  });
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has("foundry") ? "foundry" : false),
  });

  server.on("upgrade", (req, socket, head) => {
    const token = tokenFrom(req);
    const claims = token ? verifyToken<RealtimeClaims>(token, opts.secret) : null;
    if (!claims?.teamId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, claims, alive: true };
      clients.add(client);
      ws.on("pong", () => {
        client.alive = true;
      });
      ws.on("close", () => clients.delete(client));
      ws.on("error", () => clients.delete(client));
      ws.send(JSON.stringify({ type: "hello", teamId: claims.teamId }));
    });
  });

  const ping = setInterval(() => {
    const nowS = Date.now() / 1000;
    for (const c of clients) {
      // Tokens are short-lived; drop clients once theirs expires so they reconnect with a fresh one.
      if (!c.alive || c.claims.exp < nowS) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 25_000);

  const broadcast = (change: ChangeMessage): number => {
    const msg = JSON.stringify({ type: "change", table: change.table, id: change.id, op: change.op });
    let sent = 0;
    for (const c of clients) {
      if (c.claims.teamId !== change.team_id || c.ws.readyState !== WebSocket.OPEN) continue;
      c.ws.send(msg);
      sent++;
    }
    return sent;
  };

  const listener = opts.sql
    ? await opts.sql.listen(CHANNEL, (payload) => {
        try {
          broadcast(JSON.parse(payload) as ChangeMessage);
        } catch {
          // ignore malformed payloads
        }
      })
    : null;

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));

  return {
    server,
    broadcast,
    clientCount: () => clients.size,
    async close() {
      clearInterval(ping);
      await listener?.unlisten();
      for (const c of clients) c.ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
