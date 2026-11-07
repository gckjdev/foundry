# Handoff brief: Garbage-collect finished worktrees and parked worktrees after 7 days

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T15:50:21.515Z

## Plan

1. `apps/runner/src/gc.ts`: change `PARKED_TTL_MS` from `3 * 24 * 3600_000` to `7 * 24 * 3600_000`.

2. `packages/shared/src/api.ts`: add `keepJobIds: z.array(z.string())` to `HeartbeatResponseSchema` (type auto-derives).

3. `packages/control/src/runners.ts` `heartbeat()`: query jobs assigned to this runner whose status is `needs_input` or in `RUNNING_STATUSES`, return their ids as `keepJobIds`.

4. `apps/runner/src/daemon.ts`: store `keepJobIds` from the last heartbeat; pass `keep: null` in the `start()` GC call; pass `keep: new Set(lastHeartbeat.keepJobIds)` in `gc()`.

5. `apps/runner/src/testing.ts`: add `keepJobIds: []` to the fake `heartbeatResponse`.

6. `apps/runner/src/api.test.ts`: add `keepJobIds: []` to the heartbeat fixture (schema parse requires it).

7. Tests: new `apps/runner/src/gc.test.ts` with the 5 acceptance cases; add a zod parse assertion for the heartbeat response in `packages/shared/src/shared.test.ts`.

## Findings

- triage: Ticket is clear with concrete acceptance criteria. Moving to code investigation.
- investigating: Located gc.ts, daemon.ts, heartbeat schema/control, and fake/test fixtures. Plan recorded; implementing now.
- implementing: Implemented all changes; run_checks passed (lint, typecheck, test) and the control-side change was verified against a local Postgres with a new test.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "e0602958-70aa-44f0-81b6-2e6c7602dba9",
  "title": "Garbage-collect finished worktrees and parked worktrees after 7 days",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "c3b686bd-fced-4574-a8f5-7884d81482b8",
  "plan": "1. `apps/runner/src/gc.ts`: change `PARKED_TTL_MS` from `3 * 24 * 3600_000` to `7 * 24 * 3600_000`.\n\n2. `packages/shared/src/api.ts`: add `keepJobIds: z.array(z.string())` to `HeartbeatResponseSchema` (type auto-derives).\n\n3. `packages/control/src/runners.ts` `heartbeat()`: query jobs assigned to this runner whose status is `needs_input` or in `RUNNING_STATUSES`, return their ids as `keepJobIds`.\n\n4. `apps/runner/src/daemon.ts`: store `keepJobIds` from the last heartbeat; pass `keep: null` in the `start()` GC call; pass `keep: new Set(lastHeartbeat.keepJobIds)` in `gc()`.\n\n5. `apps/runner/src/testing.ts`: add `keepJobIds: []` to the fake `heartbeatResponse`.\n\n6. `apps/runner/src/api.test.ts`: add `keepJobIds: []` to the heartbeat fixture (schema parse requires it).\n\n7. Tests: new `apps/runner/src/gc.test.ts` with the 5 acceptance cases; add a zod parse assertion for the heartbeat response in `packages/shared/src/shared.test.ts`.",
  "findings": [
    "triage: Ticket is clear with concrete acceptance criteria. Moving to code investigation.",
    "investigating: Located gc.ts, daemon.ts, heartbeat schema/control, and fake/test fixtures. Plan recorded; implementing now.",
    "implementing: Implemented all changes; run_checks passed (lint, typecheck, test) and the control-side change was verified against a local Postgres with a new test."
  ],
  "checks": [
    {
      "name": "lint",
      "status": "passed"
    },
    {
      "name": "typecheck",
      "status": "passed"
    },
    {
      "name": "test",
      "status": "passed"
    }
  ],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T15:50:21.515Z"
}
```
