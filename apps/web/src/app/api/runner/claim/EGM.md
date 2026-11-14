# web/src/app/api/runner/claim

## Overview

Claims the next eligible job for the authenticated runner.

## Interface

- `POST` — `runnerRoute(null, ({ ctx, runner }) => ({ job: await claimJob(ctx, runner) }))` ([route.ts:POST]).

## Invariants

- The route takes no body; eligibility (schedule, readiness, budget, max concurrency) is decided by `claimJob` ([route.ts:POST]).
- A runner with no eligible job receives a `null` job ([route.ts:POST]).
- Authentication is the runner bearer token ([route.ts:POST]).

## Side Effects

- `claimJob` may transition a queued job to a claimed/running state and assign it to the runner ([route.ts:POST]).

## Verification

- Run: `pnpm test`
