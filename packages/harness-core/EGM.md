# @foundry/harness-core

## Overview

The harness adapter contract and shared helpers used by every harness implementation: interfaces, the scripted `FakeHarness`, an async event queue, harness-log rendering, skill discovery and permission helpers. Package boundary: name `@foundry/harness-core`, ESM, exports TypeScript source `[package.json:exports]`. Single entry point `.` → `./src/index.ts` `[package.json:exports]`. Depends only on `@foundry/shared` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): `HarnessAdapter`/`HarnessSession`, `FakeHarness`, `AsyncQueue`, log and skill helpers.

## Interface

- `.` re-exports the types and helpers in [src](./src/EGM.md) `[src/index.ts]`.

## Invariants

- Session events are an `AsyncIterable` that stays open until the session closes `[src/queue.ts:AsyncQueue]`.
- The `id` promise resolves once per session `[src/types.ts:HarnessSession]`.

## Side Effects

- `appendHarnessLog` writes the job `.harness.log`; `FakeHarness` is in-memory only.

## Verification

- Run: `pnpm test`
