# @foundry/harness-opencode — Source

## Overview

OpenCode harness adapter. It runs a local `opencode serve` process per worktree, talks to it over localhost HTTP + SSE, maps provider events into `HarnessEvent`s and tears the server down when the session releases.

## Interface

- `[index.ts]` — `OpencodeAdapter` and re-exports.
- `[adapter.ts]` — `OpencodeAdapter`: `start`, `resume`, `release(cwd)`; server lifecycle.
- `[config.ts]` — `startOpencodeServer`, `opencodeBinary`, `opencodeConfig`, `splitModel`, `harnessPort`.
- `[events.ts]` — `OpencodeEventMapper`: maps SSE payloads to text/tool/step events; `MAX_PROVIDER_RETRIES = 3`.

## Invariants

- One server per cwd, reused while the config is unchanged `[adapter.ts:start]`.
- `harnessPort` is required; the adapter fails fast when it is unset `[config.ts:harnessPort]`.
- Readiness is confirmed by polling `/config` before any prompt `[config.ts:startOpencodeServer]`.
- The event subscription is established before `promptAsync` so no event is lost `[adapter.ts]`.
- Text, tool and step events are emitted once each; provider retries cap at 3 `[events.ts:MAX_PROVIDER_RETRIES]`.
- `release(cwd)` kills the corresponding server and removes it from the registry `[adapter.ts:release]`.

## Side Effects

- Spawns `opencode serve` and terminates it via `killTree`.
- Localhost HTTP/SSE traffic; model requests go out through the provider's proxy settings.
- Appends to the job harness log.

## Verification

- Run: `pnpm test`
