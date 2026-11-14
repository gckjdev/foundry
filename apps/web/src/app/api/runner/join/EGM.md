# web/src/app/api/runner/join

## Overview

Registers a runner against a one-time join token and returns its persistent
runner token and ids.

## Interface

- `POST(req)` with `JoinRequestSchema` (join token, name, kind, OS info, cpu/mem, max concurrency) — returns the `joinRunner` response ([route.ts:POST]).

## Invariants

- This is the only unauthenticated runner route; authorization is the `fdj_` join token in the body ([route.ts:POST]).
- The body must satisfy `JoinRequestSchema`; malformed input returns the standard 400 ([route.ts:POST]).
- The returned runner token is stored by the CLI in the OS secret store, not in config ([../../../runner/src/cli.ts:join_]).
- The join token is single-use/expiring (enforced by `joinRunner`) ([route.ts:POST]).

## Side Effects

- Creates/updates the runner row, consumes the join token, and issues a runner token ([route.ts:POST]).

## Verification

- Run: `pnpm test`
