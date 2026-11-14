# web/src/app/api/realtime-token

## Overview

Mints the short-lived token and URL the panel uses to open a realtime WebSocket.

## Interface

- `GET()` — requires the current team and returns `{ url: ctx.realtimeUrl, token: realtimeToken(ctx, { teamId, sub: user.id, kind: "user" }) }` ([route.ts:GET]).

## Invariants

- The token is scoped to the caller's team and user and signed with the control secret ([route.ts:GET]).
- The returned URL comes from the control context (`FOUNDRY_REALTIME_URL`), not from the request ([route.ts:GET]).
- Access requires a signed-in team member ([route.ts:GET]).

## Side Effects

- Signs a JWT via `realtimeToken`; no DB writes ([route.ts:GET]).

## Verification

- Run: `pnpm test`
