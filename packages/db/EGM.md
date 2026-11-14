# @foundry/db

## Overview

Postgres layer for the control plane: Drizzle schema, the migrator and test-database helpers. Package boundary: name `@foundry/db`, ESM, exports TypeScript source `[package.json:exports]`. Entry points `.` → `./src/index.ts`, `./migrate` → `./src/migrate.ts`, `./testing` → `./src/testing.ts` `[package.json:exports]`. The `migrate` script runs `tsx src/migrate-cli.ts` `[package.json:scripts]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): schema, `createDatabase`/`getDatabase`, migrator and test helpers.
- [migrations](./migrations/EGM.md): ordered SQL migrations and the prunable `meta/` snapshots.

## Interface

- `.` exports `createDatabase`, `getDatabase`, the `Db`/`Database` types and every table/row type `[src/index.ts]`.
- `./migrate` exports `migrate` `[src/migrate.ts]`.
- `./testing` exports `createTestDatabase` and the test-URL lookup `[src/testing.ts]`.

## Invariants

- Importing the package never connects; `getDatabase` is a lazy singleton `[src/index.ts:getDatabase]`.
- Migrations are idempotent and transactional per file `[src/migrate.ts:migrate]`.

## Side Effects

- Opens Postgres connections, applies DDL and can create/drop test databases.

## Verification

- Run: `pnpm test`
