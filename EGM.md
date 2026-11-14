# Foundry Blueprint

## System Overview

Foundry turns GitHub issues into verified, merged pull requests. A Next.js control plane (`apps/web`) ingests GitHub webhooks and serves the panel, a WebSocket bridge (`apps/realtime`) fans out Postgres LISTEN/NOTIFY changes, and per-machine runners (`apps/runner`) claim jobs, run a coding harness inside a git worktree, and report progress back over a bearer-token HTTP API. Domain state lives in Postgres (`packages/db`), business rules in `packages/control`, and cross-cutting contracts in `packages/shared`.

## Local Interface & Invariants

- Root-level executable configuration is limited to tooling; application code lives in workspaces.
- `vitest.config.ts` — `defineConfig` registers a `text-as-string` plugin that turns `.md` and `.mjs` imports into string exports, aliases `@` → `apps/web/src`, `server-only`/`next/server`/`next/cache` → `tests/shims/*`, and defines three projects: `unit` (all `packages/*/src` and `apps/*/src` tests, excluding `packages/control` and `packages/db`), `api` (control, db, and `tests/api`), and `e2e` (`tests/e2e`, 60 s timeouts) [vitest.config.ts].
- `playwright.config.ts` — runs `tests/playwright` against `FOUNDRY_E2E_BASE_URL` or a spawned `next dev` on port 3456; the spawned server forces `DATABASE_URL` and `FOUNDRY_SECRET` empty and supplies Playwright default auth secrets [playwright.config.ts].
- Root `package.json` scripts are the verification surface: `test` (`vitest run`), `test:unit`, `test:api`, `test:e2e` (`playwright test`), `test:report`, `typecheck` (turbo), `lint` (Biome), and `db:migrate` [package.json:scripts].
- TypeScript is strict ESM with `"type": "module"`; workspace packages export source `.ts`, not `dist` [package.json, tsconfig.base.json].

## Subdirectories & System Boundaries

- apps: [./apps/EGM.md](./apps/EGM.md) — control plane, realtime bridge, and runner CLI/daemon as pnpm workspace packages.
- packages: [./packages/EGM.md](./packages/EGM.md) — shared libraries, control-plane domain layer, adapters, and the per-job MCP server.
- scripts: [./scripts/EGM.md](./scripts/EGM.md) — root-level Node ESM helpers for coverage reporting and smee webhook forwarding.
- packaging: [./packaging/EGM.md](./packaging/EGM.md) — nfpm and Homebrew release-packaging assets consumed by `apps/runner/scripts/build-release.ts`.

## Global Invariants

- Job status transitions are defined once in `packages/shared/src/states.ts`; every move passes `assertTransition`/`transitionJob` [packages/shared/src/states.ts].
- GitHub tokens remain in `http.extraheader`, never in remote URLs or argv [apps/runner/src/EGM.md].
- All outbound HTTP goes through `@foundry/shared/proxy`; loopback is excluded [packages/shared/src/proxy.ts].
- Runner source uses `node:` APIs only — no `bun:` imports — so Vitest can execute it; Bun is the build/run tool [apps/runner/package.json:scripts].
- Operational logs are one structured JSON record per line via `createLogger` [packages/shared/src/log.ts].
- SQL timestamps are ISO strings cast `::timestamptz`; `Date` objects never go inside nested `sql` fragments [packages/db/migrations/EGM.md].
- GitHub webhooks are signature-verified against the raw body before JSON parsing [apps/web/src/app/api/webhooks/github/EGM.md].

## Global Side Effects

- Postgres is the shared state store: control plane jobs/events, runner readiness, and realtime `LISTEN foundry_changes` [packages/db/src/EGM.md, apps/realtime/src/EGM.md].
- GitHub REST/GraphQL calls mint installation tokens and mutate labels, comments, PRs, and reviews [packages/github/src/EGM.md].
- Runners mutate the host: `FOUNDRY_HOME` state, git mirrors/worktrees, per-job databases, spawned processes, service definitions, and sleep inhibitors [apps/runner/src/EGM.md].
- Harness adapters spawn Claude Code or OpenCode processes and append `.harness.log` files [packages/harness-core/src/EGM.md].
- The realtime service and control plane bind TCP ports (default 3000/3001) and the MCP bridge binds a Unix socket or loopback port [apps/EGM.md, packages/mcp-foundry/src/EGM.md].

## System Verification

- Run: `pnpm test` (set `FOUNDRY_TEST_DATABASE_URL` to include DB/control API tests)
- Browser E2E: `pnpm test:e2e`
