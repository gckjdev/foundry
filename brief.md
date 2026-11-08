# Handoff brief: Show queued jobs with no runner online on the inbox

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T00:08:16.970Z

## Plan

1. `packages/control/src/queries.ts` — extend `inbox()` to compute `blocked: { job: Job; reason: string }[]` from the caller's own jobs using `diagnoseQueue` (queued jobs with a non-null reason). Include `blocked: []` in the unknown-user early return.
2. `apps/web/src/app/(panel)/inbox/page.tsx` — add a "Blocked — no capacity" `Section` immediately above "Your tickets in flight", rendering `JobRow` with `note={reason}`; empty copy "No jobs waiting on a runner."
3. `packages/control/src/control.test.ts` — add a test: seedTeam (alice), insert a queued job for alice and one for another member bob, no runners; assert alice's `inbox().blocked` contains her job with reason "no runners joined", and bob's inbox does not list alice's job.
4. `packages/control/src/surfaces.test.ts` — update the exact-equality expectation for an unknown user to include `blocked: []` (shape change).
5. Verify: `pnpm exec biome check --write` on touched files, `pnpm --filter @foundry/control typecheck`, `pnpm --filter @foundry/web exec tsc --incremental false`, `pnpm exec vitest run packages/control/src/control.test.ts packages/control/src/surfaces.test.ts`.
6. Screenshot `/inbox` with a seeded blocked row via `pnpm --filter @foundry/web exec next dev --port $FOUNDRY_PORT`; attach as evidence.

## Findings

- triage: Ticket is clear: extend inbox() with blocked queued jobs and render a new inbox section. Found inbox()/diagnoseQueue, the inbox page, and the existing surfaces/control tests.
- investigating: Plan recorded: extend inbox() with blocked rows, render the new section, add a focused control-plane test, update the inbox shape assertion, then verify and screenshot.
- implementing: Implemented blocked queue rows in inbox(), rendered the new section, added the ownership/blocked test, and captured an /inbox screenshot showing the section with a queued row.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "d4db9106-b436-40e0-9b67-67ac757e7452",
  "title": "Show queued jobs with no runner online on the inbox",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "9e92409b-e92a-4230-8a65-d0c98a04dfce",
  "plan": "1. `packages/control/src/queries.ts` — extend `inbox()` to compute `blocked: { job: Job; reason: string }[]` from the caller's own jobs using `diagnoseQueue` (queued jobs with a non-null reason). Include `blocked: []` in the unknown-user early return.\n2. `apps/web/src/app/(panel)/inbox/page.tsx` — add a \"Blocked — no capacity\" `Section` immediately above \"Your tickets in flight\", rendering `JobRow` with `note={reason}`; empty copy \"No jobs waiting on a runner.\"\n3. `packages/control/src/control.test.ts` — add a test: seedTeam (alice), insert a queued job for alice and one for another member bob, no runners; assert alice's `inbox().blocked` contains her job with reason \"no runners joined\", and bob's inbox does not list alice's job.\n4. `packages/control/src/surfaces.test.ts` — update the exact-equality expectation for an unknown user to include `blocked: []` (shape change).\n5. Verify: `pnpm exec biome check --write` on touched files, `pnpm --filter @foundry/control typecheck`, `pnpm --filter @foundry/web exec tsc --incremental false`, `pnpm exec vitest run packages/control/src/control.test.ts packages/control/src/surfaces.test.ts`.\n6. Screenshot `/inbox` with a seeded blocked row via `pnpm --filter @foundry/web exec next dev --port $FOUNDRY_PORT`; attach as evidence.",
  "findings": [
    "triage: Ticket is clear: extend inbox() with blocked queued jobs and render a new inbox section. Found inbox()/diagnoseQueue, the inbox page, and the existing surfaces/control tests.",
    "investigating: Plan recorded: extend inbox() with blocked rows, render the new section, add a focused control-plane test, update the inbox shape assertion, then verify and screenshot.",
    "implementing: Implemented blocked queue rows in inbox(), rendered the new section, added the ownership/blocked test, and captured an /inbox screenshot showing the section with a queued row."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T00:08:16.970Z"
}
```
