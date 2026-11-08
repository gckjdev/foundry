# Handoff brief: Support SQLite so local Foundry runs without Postgres

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T04:08:00.793Z

## Plan

## Plan (updated after merging `main`)

### What changed since the original plan
Merged `origin/main` (31 commits) into the branch. Three things from `main` touch the database/realtime path and had to be reconciled with the SQLite work:

1. **New `jobs` columns** (`max_job_minutes`, `max_cost_usd`, `last_review_id`) — mirrored into `packages/db/src/schema.sqlite.ts` (`integer`/`real`/`integer`) and `packages/db/migrations-sqlite/0000_init.sql`.
2. **Realtime `columns` payload + client noise filter** (PR #51): the WebSocket change message now carries `columns` and the board skips cosmetic `jobs` updates. The SQLite outbox (`_foundry_changes`) gained a `columns` TEXT column, and the `jobs_changes_update` trigger now computes the actually-changed column names via `json_group_array` over null-safe `IS NOT` comparisons (mirrors the Postgres `IS DISTINCT FROM`). The realtime poll reads `columns` and forwards it to `broadcast()`.
3. **`capacityCard` (pg-only window-function SQL)** on the runners page — added `capacityCardSqlite`, a TS implementation that fetches `stage_changed` events and merges queue-stay intervals, dispatched on `ctx.dialect`.

### Original design (unchanged)
- `packages/db`: dual driver via `createDatabase(url)` branching on the URL scheme — Postgres (`postgres-js`) unchanged; SQLite via `drizzle-orm/libsql` + `@libsql/client` (async transactions match the existing `await tx` code). `schema.ts` stays the canonical Postgres source of truth; `schema.sqlite.ts` mirrors it and the table exports are Proxies that delegate to the active schema.
- SQLite migrations live in `migrations-sqlite/` and are applied per-statement in a write transaction.
- `claim.ts`: SQLite claims with an atomic conditional `UPDATE … WHERE id = ? AND status = 'queued'` + `.returning()` (no `FOR UPDATE SKIP LOCKED`); `jobs.ts` skips `.for("update")` on SQLite; `metrics.ts` computes `TeamMetrics` in TS on SQLite.
- Realtime: poll `_foundry_changes` on a ≤1s interval when SQLite, else `LISTEN/NOTIFY`.

### Files touched in this reconciliation
- `packages/db/src/schema.sqlite.ts`, `packages/db/migrations-sqlite/0000_init.sql`
- `apps/realtime/src/server.ts` (+ `server.sqlite.test.ts`)
- `packages/control/src/metrics.ts` (+ `metrics.sqlite.test.ts`)
- `packages/db/src/db.sqlite.test.ts`

### Verification
- `pnpm --filter {db,control,realtime,web} typecheck`, targeted SQLite Vitest files, `DATABASE_URL=file:… pnpm db:migrate` (applies + idempotent), then the full `run_checks` gate.

## Findings

- triage: The ticket is detailed and unambiguous: add SQLite support as an alternative control-plane datastore via a URL-scheme switch in packages/db, with a realtime poll fallback and a SQLite-safe claim. Acceptance criteria and constraints are concrete. Proceeding to investigate the existing code.
- investigating: Investigation established the full data path and a critical constraint: control uses async Drizzle transactions, so the SQLite driver must be async (libsql, not better-sqlite3). Plan: dual schema with pg as canonical types + runtime table proxies, a libsql driver, a SQLite migration set with a change-log outbox for realtime polling, and small dialect branches in claim/jobs/metrics/realtime. Recorded the plan and moved to implementation.
- implementing: Verification complete: run_checks passes lint, typecheck, and the full test suite (131 tests passing plus the new SQLite driver/claim/board/metrics/realtime-poll tests). `DATABASE_URL=file:./data/foundry.sqlite pnpm db:migrate` applies the SQLite migration and is idempotent. Biome and frozen-lockfile install are clean.
- implementing: Implementation is committed (checkpoint 81a69b2): dual-driver packages/db (libsql for SQLite, postgres unchanged), dialect branches in claim/jobs/metrics, realtime poll fallback, docs/gitignore. Re-running the gate checks and a live SQLite migrate/claim smoke test to confirm the committed state.
- implementing: Reconciled the SQLite work with the latest main: mirrored the three new jobs columns, made the SQLite realtime outbox compute and forward changed column names (matching main's new payload contract), and added a SQLite branch for capacityCard. Targeted SQLite tests, package typechecks, and a fresh SQLite migrate smoke test all pass.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

- The Postgres test suite runs only when FOUNDRY_TEST_DATABASE_URL points at a Postgres the tests can CREATE DATABASE on; I could not exercise that locally, so the pg-only branch (metrics views / SKIP LOCKED / LISTEN) is verified by compilation and the branch was left byte-identical rather than by a live Postgres run.

```json
{
  "version": 1,
  "jobId": "0ff6c308-271a-439c-abd1-e07c121da4f2",
  "title": "Support SQLite so local Foundry runs without Postgres",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "694c57ce-5296-4073-bb8d-0bc0b98ed87b",
  "plan": "## Plan (updated after merging `main`)\n\n### What changed since the original plan\nMerged `origin/main` (31 commits) into the branch. Three things from `main` touch the database/realtime path and had to be reconciled with the SQLite work:\n\n1. **New `jobs` columns** (`max_job_minutes`, `max_cost_usd`, `last_review_id`) — mirrored into `packages/db/src/schema.sqlite.ts` (`integer`/`real`/`integer`) and `packages/db/migrations-sqlite/0000_init.sql`.\n2. **Realtime `columns` payload + client noise filter** (PR #51): the WebSocket change message now carries `columns` and the board skips cosmetic `jobs` updates. The SQLite outbox (`_foundry_changes`) gained a `columns` TEXT column, and the `jobs_changes_update` trigger now computes the actually-changed column names via `json_group_array` over null-safe `IS NOT` comparisons (mirrors the Postgres `IS DISTINCT FROM`). The realtime poll reads `columns` and forwards it to `broadcast()`.\n3. **`capacityCard` (pg-only window-function SQL)** on the runners page — added `capacityCardSqlite`, a TS implementation that fetches `stage_changed` events and merges queue-stay intervals, dispatched on `ctx.dialect`.\n\n### Original design (unchanged)\n- `packages/db`: dual driver via `createDatabase(url)` branching on the URL scheme — Postgres (`postgres-js`) unchanged; SQLite via `drizzle-orm/libsql` + `@libsql/client` (async transactions match the existing `await tx` code). `schema.ts` stays the canonical Postgres source of truth; `schema.sqlite.ts` mirrors it and the table exports are Proxies that delegate to the active schema.\n- SQLite migrations live in `migrations-sqlite/` and are applied per-statement in a write transaction.\n- `claim.ts`: SQLite claims with an atomic conditional `UPDATE … WHERE id = ? AND status = 'queued'` + `.returning()` (no `FOR UPDATE SKIP LOCKED`); `jobs.ts` skips `.for(\"update\")` on SQLite; `metrics.ts` computes `TeamMetrics` in TS on SQLite.\n- Realtime: poll `_foundry_changes` on a ≤1s interval when SQLite, else `LISTEN/NOTIFY`.\n\n### Files touched in this reconciliation\n- `packages/db/src/schema.sqlite.ts`, `packages/db/migrations-sqlite/0000_init.sql`\n- `apps/realtime/src/server.ts` (+ `server.sqlite.test.ts`)\n- `packages/control/src/metrics.ts` (+ `metrics.sqlite.test.ts`)\n- `packages/db/src/db.sqlite.test.ts`\n\n### Verification\n- `pnpm --filter {db,control,realtime,web} typecheck`, targeted SQLite Vitest files, `DATABASE_URL=file:… pnpm db:migrate` (applies + idempotent), then the full `run_checks` gate.",
  "findings": [
    "triage: The ticket is detailed and unambiguous: add SQLite support as an alternative control-plane datastore via a URL-scheme switch in packages/db, with a realtime poll fallback and a SQLite-safe claim. Acceptance criteria and constraints are concrete. Proceeding to investigate the existing code.",
    "investigating: Investigation established the full data path and a critical constraint: control uses async Drizzle transactions, so the SQLite driver must be async (libsql, not better-sqlite3). Plan: dual schema with pg as canonical types + runtime table proxies, a libsql driver, a SQLite migration set with a change-log outbox for realtime polling, and small dialect branches in claim/jobs/metrics/realtime. Recorded the plan and moved to implementation.",
    "implementing: Verification complete: run_checks passes lint, typecheck, and the full test suite (131 tests passing plus the new SQLite driver/claim/board/metrics/realtime-poll tests). `DATABASE_URL=file:./data/foundry.sqlite pnpm db:migrate` applies the SQLite migration and is idempotent. Biome and frozen-lockfile install are clean.",
    "implementing: Implementation is committed (checkpoint 81a69b2): dual-driver packages/db (libsql for SQLite, postgres unchanged), dialect branches in claim/jobs/metrics, realtime poll fallback, docs/gitignore. Re-running the gate checks and a live SQLite migrate/claim smoke test to confirm the committed state.",
    "implementing: Reconciled the SQLite work with the latest main: mirrored the three new jobs columns, made the SQLite realtime outbox compute and forward changed column names (matching main's new payload contract), and added a SQLite branch for capacityCard. Targeted SQLite tests, package typechecks, and a fresh SQLite migrate smoke test all pass."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [
    "The Postgres test suite runs only when FOUNDRY_TEST_DATABASE_URL points at a Postgres the tests can CREATE DATABASE on; I could not exercise that locally, so the pg-only branch (metrics views / SKIP LOCKED / LISTEN) is verified by compilation and the branch was left byte-identical rather than by a live Postgres run."
  ],
  "updatedAt": "2026-11-08T04:08:00.793Z"
}
```
