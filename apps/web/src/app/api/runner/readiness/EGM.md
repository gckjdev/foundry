# web/src/app/api/runner/readiness

## Overview

Records whether a runner has proven a repo's recipe at its current recipe sha.

## Interface

- `POST` with `ReadinessRequestSchema` (`repoId`, `recipeSha`, `ready`, `reason`) — returns `reportReadiness(ctx, runner, body)` ([route.ts:POST]).

## Invariants

- The body requires `repoId`, `ready`, and a nullable `reason`/`recipeSha` per the shared schema ([route.ts:POST]).
- Reports are keyed by runner and repo so the panel can show staleness when the sha no longer matches ([../../../runner/src/readiness.ts:sync]).
- Authentication is the runner bearer token ([route.ts:POST]).

## Side Effects

- Upserts a runner-repo readiness row ([route.ts:POST]).

## Verification

- Run: `pnpm test`
