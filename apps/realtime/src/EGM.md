# realtime/src

## Overview

Two files implement the service: `main.ts` reads configuration, opens a small
Postgres pool, and installs signal handlers; `server.ts` creates the HTTP +
WebSocket server, authenticates upgrade requests, pings clients, and broadcasts
LISTEN payloads.

## Interface

- `CHANNEL` — the Postgres NOTIFY channel name (`foundry_changes`) ([server.ts:CHANNEL]).
- `ChangeMessage { table, id, team_id, op, columns? }` — the notification payload shape ([server.ts:ChangeMessage]).
- `RealtimeServer { server, broadcast(change): number, clientCount(), close() }` ([server.ts:RealtimeServer]).
- `startRealtime({ sql, secret, port }): Promise<RealtimeServer>` — build and start the service; `sql` may be `null` (tests) ([server.ts:startRealtime]).
- Process entry point `main.ts` — requires `DATABASE_URL` and `FOUNDRY_SECRET`, listens on `PORT` (default 3001), and closes the server and pool on SIGTERM/SIGINT ([main.ts]).

## Invariants

- Only WebSocket upgrades are served; `/healthz` returns `ok`, every other HTTP path returns 426 ([server.ts:startRealtime]).
- The token is read from the `token` query parameter or the second `sec-websocket-protocol` entry after `foundry`; a missing/invalid/teamless token is rejected with 401 ([server.ts:tokenFrom]).
- `broadcast` sends only to clients whose `claims.teamId` equals `change.team_id` and that are OPEN ([server.ts:broadcast]).
- Messages carry only `{type:"change", table, id, op, columns}`, never row data ([server.ts:broadcast]).
- A 25 s ping interval terminates clients that stop ponging or whose token `exp` has passed ([server.ts:startRealtime]).
- Malformed LISTEN payloads are ignored rather than crashing the listener ([server.ts:startRealtime]).

## Side Effects

- Opens a Postgres connection and runs `LISTEN foundry_changes`; `close()` runs `UNLISTEN` ([server.ts:startRealtime]).
- Binds a TCP port and an HTTP server; terminates WebSocket clients on close.
- Mutates process lifecycle: `main.ts` calls `process.exit` on missing config and on shutdown.

## Verification

- Run: `pnpm test`
