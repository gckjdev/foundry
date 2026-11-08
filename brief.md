# Handoff brief: Fix bug: Job shows twice in board if cancelled then retry

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T03:26:25.946Z

## Plan

1. `packages/control/src/jobs.ts` — make `createJobFromIssue` keep one job per issue: reuse a live job; if the latest job is cancelled/failed, revive it in place (`transitionJob` to `queued`, resume at triage); only a merged job starts a new attempt. Order `anyJobForIssue` by newest first so legacy duplicate rows resolve deterministically.
2. `packages/control/src/control.test.ts` — regression tests: re-applying the `foundry` label after cancel, and after failure, keeps exactly one job row and re-queues it so the board's single card moves back to the right lane.
3. Verify: run the control/surfaces DB tests against a throwaway Postgres, typecheck the control package, and run the recipe checks. No board-page change is needed — `boardJobs` already collapses legacy duplicate rows into one card, and this removes the duplicate-row root cause.

## Findings

- investigating: Root cause reproduced: retrying a cancelled job by re-applying the `foundry` label inserted a second job row (the board hid it only via dedup, and panel-retrying the old row then hit the unique index). Fixed `createJobFromIssue` to revive cancelled/failed jobs in place and only start a new row after a merge; added regression tests for the cancel and failure paths.
- implementing: Implemented the in-place revive in `createJobFromIssue` and added regression tests. Manual verification against a throwaway Postgres: the new tests fail on the old code and pass now; full Vitest suite green (198 tests). Running the recipe checks next.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "ff226447-a50b-45c1-b9dc-ddce921a3f41",
  "title": "Fix bug: Job shows twice in board if cancelled then retry",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "0c0caa90-c488-464f-8228-19fb990ded12",
  "plan": "1. `packages/control/src/jobs.ts` — make `createJobFromIssue` keep one job per issue: reuse a live job; if the latest job is cancelled/failed, revive it in place (`transitionJob` to `queued`, resume at triage); only a merged job starts a new attempt. Order `anyJobForIssue` by newest first so legacy duplicate rows resolve deterministically.\n2. `packages/control/src/control.test.ts` — regression tests: re-applying the `foundry` label after cancel, and after failure, keeps exactly one job row and re-queues it so the board's single card moves back to the right lane.\n3. Verify: run the control/surfaces DB tests against a throwaway Postgres, typecheck the control package, and run the recipe checks. No board-page change is needed — `boardJobs` already collapses legacy duplicate rows into one card, and this removes the duplicate-row root cause.",
  "findings": [
    "investigating: Root cause reproduced: retrying a cancelled job by re-applying the `foundry` label inserted a second job row (the board hid it only via dedup, and panel-retrying the old row then hit the unique index). Fixed `createJobFromIssue` to revive cancelled/failed jobs in place and only start a new row after a merge; added regression tests for the cancel and failure paths.",
    "implementing: Implemented the in-place revive in `createJobFromIssue` and added regression tests. Manual verification against a throwaway Postgres: the new tests fail on the old code and pass now; full Vitest suite green (198 tests). Running the recipe checks next."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T03:26:25.946Z"
}
```
