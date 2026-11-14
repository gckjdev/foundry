# @foundry/db — Migrations

## Overview

Ordered SQL migrations applied by `[../src/migrate.ts:migrate]`. Each file is one or more statements separated by `--> statement-breakpoint` and is executed inside a single transaction. The directory also holds `meta/`, Drizzle JSON snapshots that are not run by the migrator and can be pruned.

## Interface

- `[0000_init.sql]` — creates the original 15 tables (`teams`, `users`, `memberships`, `invites`, `repos`, `runners`, `jobs`, `events`, `questions`, `job_inputs`, `evidence`, `artifacts`, `webhook_inbox`, `notifications`).
- `[0000_notify.sql]` — LISTEN/NOTIFY triggers and the views the realtime service reads.
- `[0001_*.sql]` — adds `reverted_at` and `pr_title` to `jobs`.
- `[0002_metrics.sql]` — metrics views consumed by `teamMetrics`/`jobMetrics`.
- `[0003_bigint_ids.sql]` — widens id columns to `bigint`.
- `[0004..0006,0009..0011]` — additional job/runner/evidence columns.
- `[0007_notify_columns.sql]` — notification columns.
- `[0008_team_updated_index.sql]` — index on team update time.

## Invariants

- Applied order is lexical over `*.sql`; a new migration must sort after every existing one `[../src/migrate.ts:migrate]`.
- Every file is atomic: one transaction, so a failed statement rolls the whole file back `[../src/migrate.ts:migrate]`.
- Statements must be separated by `--> statement-breakpoint` or the migrator will submit them as one statement `[../src/migrate.ts]`.
- Timestamps are `timestamptz` and are written as ISO strings, never locale-formatted dates (see the nested-`sql` note in `AGENTS.md`).
- `meta/` is tooling state, not a migration; never edit it by hand.

## Side Effects

- Applying the directory performs DDL against the target database and writes `_foundry_migrations`.
- Files are read from disk by the migrator; nothing here runs at import time.

## Verification

- Run: `pnpm test`
