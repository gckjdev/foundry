# @foundry/os-adapters

## Overview

Platform integration for the runner: secrets, service installation, sleep inhibition and process helpers behind one `OsAdapter` interface. Package boundary: name `@foundry/os-adapters`, ESM, exports TypeScript source `[package.json:exports]`. Single entry point `.` → `./src/index.ts` `[package.json:exports]`. No runtime dependencies `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): `OsAdapter`, the macOS/Linux/Windows implementations, secret stores and exec helpers.

## Interface

- `.` exports `currentOsAdapter` and the `OsAdapter` types `[src/index.ts]`.

## Invariants

- Platform selection is exhaustive over `darwin`/`linux`/`win32` `[src/index.ts:currentOsAdapter]`.
- `exec` never throws for timeout (124) or not-found (127); `killTree` never throws `[src/exec.ts]`.

## Side Effects

- Spawns system commands and manages secret files, service definitions and sleep inhibitors.

## Verification

- Run: `pnpm test`
