# @foundry/control

## Overview

Control-plane business logic consumed by the Next.js route handlers and the runner HTTP API. Package boundary: name `@foundry/control`, ESM, exports TypeScript source `[package.json:exports]`. Two entry points: `.` → `./src/index.ts` and `./testing` → `./src/testing.ts` for test helpers `[package.json:exports]`. Depends on `@foundry/db`, `@foundry/github`, `@foundry/playbooks` and `@foundry/shared` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): jobs, claim, ingest, merge gate, PR review, runners, questions, metrics, sweeper and the worker.

## Interface

- `@foundry/control` re-exports the modules in [src](./src/EGM.md) `[src/index.ts]`.
- `@foundry/control/testing` exposes fixtures (`newTestContext`, `seedTeam`, `seedRunner`, `seedJob`, `FakeGitHubFactory`) for API and E2E tests `[src/testing.ts]`.

## Invariants

- Business rules live here, not in route handlers; routes parse, auth, call control and return.
- Every job status move goes through `transitionJob`, which enforces `assertTransition` from `@foundry/shared` `[src/jobs.ts:transitionJob]`.

## Side Effects

- Database writes, GitHub calls, realtime events and notifications; all injected through the control context.
- Background timers start only when `startSweeper` / `startWorker` is called.

## Verification

- Run: `pnpm test`
