# @foundry/db — Source

## Overview

Postgres access layer. Defines the Drizzle schema, the one-shot migrator used by `pnpm db:migrate`, and helpers for spinning up throwaway databases in tests. It never contains business rules; control-plane code owns those.

## Interface

- `[index.ts:createDatabase]` / `[index.ts:getDatabase]` — `createDatabase(url, options)` opens a `postgres.js` client wrapped in Drizzle; `getDatabase()` returns a process-wide singleton that requires `DATABASE_URL` and limits the pool to 10. Types `Db` and `Database` are the handler-facing aliases.
- `[schema.ts]` — tables and row types: `teams`, `users`, `memberships`, `invites`, `repos`, `runners`, `runnerRepoReadiness`, `jobs`, `events`, `questions`, `jobInputs`, `evidence`, `artifacts`, `webhookInbox`, `notifications`; each with an inferred `$inferSelect` type.
- `[migrate.ts:migrate]` — `migrate(sql, dir)` applies every `*.sql` in lexical order, records applied names in `_foundry_migrations`, splits statements on `--> statement-breakpoint`, and runs each file in one transaction.
- `[migrate-cli.ts]` — CLI entry: loads `../../../.env`, exits 1 when `DATABASE_URL` is missing, otherwise calls `migrate`.
- `[testing.ts]` — reads `FOUNDRY_TEST_DATABASE_URL` (falling back to `TEST_DATABASE_URL`), `createTestDatabase()` creates a randomly named database, migrates it, and drops it with `force` on teardown.

## Invariants

- `getDatabase` is a lazy global singleton; importing the module never connects `[index.ts:getDatabase]`.
- Migrations are idempotent: a file already present in `_foundry_migrations` is skipped `[migrate.ts:migrate]`.
- Statement splitting relies on the `--> statement-breakpoint` marker; migrations must use it between statements `[migrate.ts]`.
- `jobs` has a partial unique index `jobs_issue_active_idx` that enforces one live job per issue `[schema.ts:jobs]`.
- `webhookInbox` has a unique `webhook_inbox_delivery_idx` so deliveries are processed once `[schema.ts:webhookInbox]`.
- Test databases always drop with `force` so a failed run does not leak databases `[testing.ts:createTestDatabase]`.

## Side Effects

- `createDatabase` / `getDatabase` open Postgres connections.
- `migrate` executes DDL and writes the `_foundry_migrations` bookkeeping table.
- `createTestDatabase` issues `CREATE DATABASE` / `DROP DATABASE`; it is test-only and never imported by runtime code.
- `migrate-cli` reads `.env` from disk and calls `process.exit`.

## Verification

- Run: `pnpm test`
