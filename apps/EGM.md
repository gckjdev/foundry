# apps Blueprint

## System Overview

`apps/` is the executable layer of the Foundry monorepo: the Next.js control plane
(`web`), the Postgres `LISTEN/NOTIFY` → WebSocket bridge (`realtime`), and the
per-machine job daemon and CLI (`runner`). Each directory is a pnpm workspace
package (`package.json` `name` is `@foundry/<dir>`) and is deployed or launched
independently.

## Subdirectories & System Boundaries

- realtime: [./realtime/EGM.md](./realtime/EGM.md) — one Postgres LISTEN connection fanned out to authenticated WebSocket clients, scoped by team.
- runner: [./runner/EGM.md](./runner/EGM.md) — `foundry` CLI and daemon: join/heartbeat/claim, git mirrors and per-job worktrees, harness driving, MCP tool socket, release builds.
- web: [./web/EGM.md](./web/EGM.md) — Next.js App Router control plane: panel, Auth.js GitHub sign-in, webhook ingest, and the runner HTTP API.

## Global Invariants

- Workspace packages are named `@foundry/<dir>` and depend on each other with `workspace:*` ([realtime/package.json], [runner/package.json], [web/package.json]).
- Runner source must use `node:` APIs and must not import `bun:` so Vitest can run it; Bun is only the runner's build/execute tool ([runner/package.json:scripts]).
- `web` and `realtime` both read `DATABASE_URL`; the control plane and the realtime bridge must point at the same Postgres database ([realtime/src/main.ts], [web/src/server/context.ts]).

## Global Side Effects

- All three apps connect to Postgres; `web` owns schema-driven writes, `realtime` only LISTENs, `runner` may create per-job databases.
- `runner` mutates the machine (git mirrors, worktrees, process spawning, services); `web` performs outbound GitHub HTTP; `realtime` binds a TCP port (default 3001).

## System Verification

- Run: `pnpm test`
