# @foundry/harness-opencode

## Overview

OpenCode harness implementation that drives a local `opencode serve` over localhost HTTP/SSE. Package boundary: name `@foundry/harness-opencode`, ESM, exports TypeScript source `[package.json:exports]`. Single entry point `.` → `./src/index.ts` `[package.json:exports]`. Depends on `@foundry/harness-core`, `@foundry/os-adapters`, `@foundry/shared` and `@opencode-ai/sdk` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): `OpencodeAdapter`, server lifecycle/config and SSE event mapping.

## Interface

- `.` exports `OpencodeAdapter` and the config/event helpers `[src/index.ts]`.

## Invariants

- One server per cwd, reused while config is unchanged `[src/adapter.ts:start]`.
- The event stream is subscribed before prompting so no event is lost `[src/adapter.ts]`.

## Side Effects

- Spawns and kills `opencode serve`; performs localhost HTTP/SSE traffic.

## Verification

- Run: `pnpm test`
