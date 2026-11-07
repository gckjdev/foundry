# Handoff brief: Support SQLite so local Foundry runs without Postgres

Stage reached: **investigating** · harness: claude-code · updated 2026-11-07T15:42:58.816Z

## Plan

## Plan: SQLite support for the Foundry control plane

### Key architectural decision
Control code uses `await ctx.db.transaction(async (tx) => { … await … })` in `claim.ts` and `jobs.ts`. Drizzle's `better-sqlite3` driver is **synchronous** and does not await async transaction callbacks (it commits as soon as the callback returns its Promise), which would break claim exclusivity and transition atomicity. So I use **`drizzle-orm/libsql` + `@libsql/client` (local `file:` mode)** — Drizzle's libsql driver has async transactions that `await` the callback, matching the existing code. This is still Drizzle (no second ORM) and still a single-process local SQLite file; the ticket's "prefer better-sqlite3" is guidance that the async-transaction constraint overrides.

### Schema strategy (keeps control's ~500 table references untouched)
- `packages/db/src/schema.ts` stays the Postgres schema and the canonical TypeScript source of truth (`Db`, `Job`, `Team`, … unchanged).
- New `packages/db/src/schema.sqlite.ts` mirrors every table with sqlite-core columns that produce **identical `$inferSelect` types**: `text` for uuid/text, `integer({mode:'timestamp_ms'})` for `timestamp with time zone` (both are `Date`), `text({mode:'json'})` for jsonb (`unknown`), `integer({mode:'boolean'})` for boolean, `real` for doublePrecision, `integer` for integer/bigint, autoincrement `integer` for bigserial.
- `createDatabase(url)` sets a module-level `activeSchema` (pg or sqlite) and returns `{ db, dialect, sql, sqlite, close }`. The table exports (`jobs`, `events`, …) become thin **Proxies** typed as the pg tables that delegate to `activeSchema` at access time — so control code keeps `import { jobs } from "@foundry/db"` and works against either dialect with correct serialization (booleans→0/1, Dates→ms, objects→JSON text).

### Changes
1. **`packages/db`** — dual driver:
   - `package.json`: add `@libsql/client`.
   - `schema.sqlite.ts` (new): mirrored sqlite schema.
   - `index.ts`: `dialectOf(url)`, sqlite file-path resolution (create parent dir), `createDatabase` branches pg vs sqlite (libsql), `Database` interface adds `dialect`/`sqlite`, `sql` becomes nullable, table proxies.
   - `migrate.ts`: branch to `migrateSqlite` (libsql `transaction("write")` + per-statement `execute`, split on `--> statement-breakpoint`).
   - `migrate-cli.ts`: use `createDatabase(url)` + unified `migrate(database)`.
   - `migrations-sqlite/0000_init.sql` (new): full final schema DDL (text UUIDs with `DEFAULT (lower(hex(randomblob(16))))`, INTEGER ms timestamps with ISO defaults via `strftime`, TEXT json, INTEGER booleans), FKs, indexes incl. the partial unique `jobs_issue_active_idx`, an `updated_at` touch trigger for jobs, a `_foundry_changes` outbox table + INSERT/UPDATE/DELETE triggers on jobs/events/questions/runners (mirrors the pg NOTIFY triggers and gives monotonic change detection for polling).
   - `testing.ts`: `createSqliteTestDatabase()` (temp file, migrate, drop on close) plus `createTestDatabase()` gains a sqlite branch when `FOUNDRY_TEST_DATABASE_URL` is `file:`/`sqlite:`.
2. **`packages/control`** — dialect branches only:
   - `context.ts`: add `dialect`, `sqlite` to `ControlContext`; `sql` becomes `Sql | null`.
   - `claim.ts`: sqlite path uses a conditional `UPDATE … WHERE id = ? AND status = 'queued'` + `.returning()` (atomic, exclusive) inside the existing transaction; pg path keeps `FOR UPDATE SKIP LOCKED`.
   - `jobs.ts`: `transitionJob` skips `.for("update")` on sqlite.
   - `metrics.ts`: when sqlite, compute `TeamMetrics` in TS from plain drizzle queries (counts, success rates, medians via sorted arrays) instead of the pg views/`percentile_cont`/`FILTER` — same shape, approximate is fine, never 500s.
3. **`apps/realtime`** — poll fallback:
   - `server.ts`: `startRealtime` accepts `{ sql, sqlite, secret, port, pollIntervalMs }`; when sqlite, poll `_foundry_changes WHERE seq > ?` on a ≤1s interval and call the existing `broadcast()`.
   - `main.ts`: use `createDatabase(url)` and pass `{sql, sqlite}`.
4. **`apps/web`** — `server/context.ts` passes `dialect`/`sqlite` into `ControlContext` (`sql` nullable).
5. **Docs + hygiene** — `.gitignore` add `*.sqlite` (and `*.sqlite-journal`/`-wal`/`-shm`); `.env.example` document the SQLite URL; `docs/local-setup.md` add a "zero-Postgres" section with `DATABASE_URL=file:./data/foundry.sqlite`.

### Tests (no Docker, no Postgres required)
- `packages/db/src/db.sqlite.test.ts`: sqlite driver + migrate + a round-trip insert of booleans/timestamps/json.
- `packages/control/src/claim.sqlite.test.ts`: two concurrent `claimJob` calls against sqlite — only one wins.
- `packages/control/src/queries.sqlite.test.ts`: `inbox` + `boardJobs` against a sqlite-backed ctx.
- Existing Postgres tests (`describe.skipIf(!TEST_DATABASE_URL)`) stay untouched; the recipe's `pnpm vitest run` will now also exercise the sqlite tests (they don't skip).

### Verification
- `pnpm --filter @foundry/db typecheck`, `pnpm --filter @foundry/control typecheck`, `pnpm --filter @foundry/realtime typecheck`, `pnpm --filter @foundry/web typecheck`.
- Targeted `pnpm exec vitest run <sqlite test files>` then `pnpm exec biome check --write` on touched files.
- `DATABASE_URL=file:./data/foundry.sqlite pnpm db:migrate` and a smoke check that `createDatabase` + migrate + one claim work against a sqlite file.
- Full `run_checks` at the end.

## Findings

- triage: The ticket is detailed and unambiguous: add SQLite support as an alternative control-plane datastore via a URL-scheme switch in packages/db, with a realtime poll fallback and a SQLite-safe claim. Acceptance criteria and constraints are concrete. Proceeding to investigate the existing code.
- investigating: Investigation established the full data path and a critical constraint: control uses async Drizzle transactions, so the SQLite driver must be async (libsql, not better-sqlite3). Plan: dual schema with pg as canonical types + runtime table proxies, a libsql driver, a SQLite migration set with a change-log outbox for realtime polling, and small dialect branches in claim/jobs/metrics/realtime. Recorded the plan and moved to implementation.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "0ff6c308-271a-439c-abd1-e07c121da4f2",
  "title": "Support SQLite so local Foundry runs without Postgres",
  "stageReached": "investigating",
  "harness": "claude-code",
  "sessionId": "03d7acb3-a6ef-47cf-b97d-05d201262ddc",
  "plan": "## Plan: SQLite support for the Foundry control plane\n\n### Key architectural decision\nControl code uses `await ctx.db.transaction(async (tx) => { … await … })` in `claim.ts` and `jobs.ts`. Drizzle's `better-sqlite3` driver is **synchronous** and does not await async transaction callbacks (it commits as soon as the callback returns its Promise), which would break claim exclusivity and transition atomicity. So I use **`drizzle-orm/libsql` + `@libsql/client` (local `file:` mode)** — Drizzle's libsql driver has async transactions that `await` the callback, matching the existing code. This is still Drizzle (no second ORM) and still a single-process local SQLite file; the ticket's \"prefer better-sqlite3\" is guidance that the async-transaction constraint overrides.\n\n### Schema strategy (keeps control's ~500 table references untouched)\n- `packages/db/src/schema.ts` stays the Postgres schema and the canonical TypeScript source of truth (`Db`, `Job`, `Team`, … unchanged).\n- New `packages/db/src/schema.sqlite.ts` mirrors every table with sqlite-core columns that produce **identical `$inferSelect` types**: `text` for uuid/text, `integer({mode:'timestamp_ms'})` for `timestamp with time zone` (both are `Date`), `text({mode:'json'})` for jsonb (`unknown`), `integer({mode:'boolean'})` for boolean, `real` for doublePrecision, `integer` for integer/bigint, autoincrement `integer` for bigserial.\n- `createDatabase(url)` sets a module-level `activeSchema` (pg or sqlite) and returns `{ db, dialect, sql, sqlite, close }`. The table exports (`jobs`, `events`, …) become thin **Proxies** typed as the pg tables that delegate to `activeSchema` at access time — so control code keeps `import { jobs } from \"@foundry/db\"` and works against either dialect with correct serialization (booleans→0/1, Dates→ms, objects→JSON text).\n\n### Changes\n1. **`packages/db`** — dual driver:\n   - `package.json`: add `@libsql/client`.\n   - `schema.sqlite.ts` (new): mirrored sqlite schema.\n   - `index.ts`: `dialectOf(url)`, sqlite file-path resolution (create parent dir), `createDatabase` branches pg vs sqlite (libsql), `Database` interface adds `dialect`/`sqlite`, `sql` becomes nullable, table proxies.\n   - `migrate.ts`: branch to `migrateSqlite` (libsql `transaction(\"write\")` + per-statement `execute`, split on `--> statement-breakpoint`).\n   - `migrate-cli.ts`: use `createDatabase(url)` + unified `migrate(database)`.\n   - `migrations-sqlite/0000_init.sql` (new): full final schema DDL (text UUIDs with `DEFAULT (lower(hex(randomblob(16))))`, INTEGER ms timestamps with ISO defaults via `strftime`, TEXT json, INTEGER booleans), FKs, indexes incl. the partial unique `jobs_issue_active_idx`, an `updated_at` touch trigger for jobs, a `_foundry_changes` outbox table + INSERT/UPDATE/DELETE triggers on jobs/events/questions/runners (mirrors the pg NOTIFY triggers and gives monotonic change detection for polling).\n   - `testing.ts`: `createSqliteTestDatabase()` (temp file, migrate, drop on close) plus `createTestDatabase()` gains a sqlite branch when `FOUNDRY_TEST_DATABASE_URL` is `file:`/`sqlite:`.\n2. **`packages/control`** — dialect branches only:\n   - `context.ts`: add `dialect`, `sqlite` to `ControlContext`; `sql` becomes `Sql | null`.\n   - `claim.ts`: sqlite path uses a conditional `UPDATE … WHERE id = ? AND status = 'queued'` + `.returning()` (atomic, exclusive) inside the existing transaction; pg path keeps `FOR UPDATE SKIP LOCKED`.\n   - `jobs.ts`: `transitionJob` skips `.for(\"update\")` on sqlite.\n   - `metrics.ts`: when sqlite, compute `TeamMetrics` in TS from plain drizzle queries (counts, success rates, medians via sorted arrays) instead of the pg views/`percentile_cont`/`FILTER` — same shape, approximate is fine, never 500s.\n3. **`apps/realtime`** — poll fallback:\n   - `server.ts`: `startRealtime` accepts `{ sql, sqlite, secret, port, pollIntervalMs }`; when sqlite, poll `_foundry_changes WHERE seq > ?` on a ≤1s interval and call the existing `broadcast()`.\n   - `main.ts`: use `createDatabase(url)` and pass `{sql, sqlite}`.\n4. **`apps/web`** — `server/context.ts` passes `dialect`/`sqlite` into `ControlContext` (`sql` nullable).\n5. **Docs + hygiene** — `.gitignore` add `*.sqlite` (and `*.sqlite-journal`/`-wal`/`-shm`); `.env.example` document the SQLite URL; `docs/local-setup.md` add a \"zero-Postgres\" section with `DATABASE_URL=file:./data/foundry.sqlite`.\n\n### Tests (no Docker, no Postgres required)\n- `packages/db/src/db.sqlite.test.ts`: sqlite driver + migrate + a round-trip insert of booleans/timestamps/json.\n- `packages/control/src/claim.sqlite.test.ts`: two concurrent `claimJob` calls against sqlite — only one wins.\n- `packages/control/src/queries.sqlite.test.ts`: `inbox` + `boardJobs` against a sqlite-backed ctx.\n- Existing Postgres tests (`describe.skipIf(!TEST_DATABASE_URL)`) stay untouched; the recipe's `pnpm vitest run` will now also exercise the sqlite tests (they don't skip).\n\n### Verification\n- `pnpm --filter @foundry/db typecheck`, `pnpm --filter @foundry/control typecheck`, `pnpm --filter @foundry/realtime typecheck`, `pnpm --filter @foundry/web typecheck`.\n- Targeted `pnpm exec vitest run <sqlite test files>` then `pnpm exec biome check --write` on touched files.\n- `DATABASE_URL=file:./data/foundry.sqlite pnpm db:migrate` and a smoke check that `createDatabase` + migrate + one claim work against a sqlite file.\n- Full `run_checks` at the end.",
  "findings": [
    "triage: The ticket is detailed and unambiguous: add SQLite support as an alternative control-plane datastore via a URL-scheme switch in packages/db, with a realtime poll fallback and a SQLite-safe claim. Acceptance criteria and constraints are concrete. Proceeding to investigate the existing code.",
    "investigating: Investigation established the full data path and a critical constraint: control uses async Drizzle transactions, so the SQLite driver must be async (libsql, not better-sqlite3). Plan: dual schema with pg as canonical types + runtime table proxies, a libsql driver, a SQLite migration set with a change-log outbox for realtime polling, and small dialect branches in claim/jobs/metrics/realtime. Recorded the plan and moved to implementation."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T15:42:58.816Z"
}
```
