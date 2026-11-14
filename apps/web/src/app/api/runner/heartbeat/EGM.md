# web/src/app/api/runner/heartbeat

## Overview

The daemon's periodic heartbeat: telemetry in, control commands out.

## Interface

- `POST` with `HeartbeatRequestSchema` — returns the `heartbeat(ctx, runner, body)` response ([route.ts:POST]).

## Invariants

- The body is validated by `HeartbeatRequestSchema` from `@foundry/shared` ([route.ts:POST]).
- The response carries realtime URL/token, draining flag, revoked job ids, keep job ids, and per-job limit overrides, which the daemon applies on each tick ([../../../runner/src/daemon.ts:tick]).
- Authentication is the runner bearer token ([route.ts:POST]).

## Side Effects

- Updates runner telemetry/state and may publish control changes ([route.ts:POST]).

## Verification

- Run: `pnpm test`
