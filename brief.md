# Handoff brief: Fix bug in Job detail page

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T07:01:47.996Z

## Plan

Root cause: in React dev (Strict Mode double-invokes effects), the first `LiveLog` poll loop keeps running after cleanup. Both loops fetch with the same cursor, both append the same events, so `lines` contains duplicate ids and React warns about duplicate `key={l.id}`.

1. Add `apps/web/src/app/(panel)/jobs/[id]/live-log-lines.ts` with the `Line` type and a pure `mergeLines(prev, incoming)` that drops already-seen ids (across and within batches) and keeps the last 1000 lines.
2. Update `live-log.tsx` to use `mergeLines`, stop applying a response after effect cleanup, and advance the cursor with `Math.max`.
3. Add `live-log-lines.test.ts` covering repeated ids from overlapping polls, duplicate ids inside one batch, the 1000-line cap, and the no-op case.
4. Verify with the unit test, Biome, web typecheck, then `run_checks`.

## Findings

- triage: Ticket is clear: React duplicate keys in live-log.tsx when rendering job event lines; acceptance is no console error on the job detail page.
- investigating: Found the cause: the polling effect in live-log.tsx is invoked twice by React Strict Mode in dev, and the first loop still appends its response after cleanup, so the same events (ids 4294/4295) are merged twice. Plan recorded.
- implementing: Implemented dedupe in mergeLines plus a stale-poll guard in LiveLog. Unit tests pass, Biome clean, web typecheck passes, and a Playwright harness reproduced the exact 4294/4295 duplicate-key errors with the old logic while the fixed code renders two lines with no console errors.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "4cea2fa6-5ba8-4e5e-87c4-7e213c91d193",
  "title": "Fix bug in Job detail page",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "0115b831-2360-4412-a0e8-3c61527f326e",
  "plan": "Root cause: in React dev (Strict Mode double-invokes effects), the first `LiveLog` poll loop keeps running after cleanup. Both loops fetch with the same cursor, both append the same events, so `lines` contains duplicate ids and React warns about duplicate `key={l.id}`.\n\n1. Add `apps/web/src/app/(panel)/jobs/[id]/live-log-lines.ts` with the `Line` type and a pure `mergeLines(prev, incoming)` that drops already-seen ids (across and within batches) and keeps the last 1000 lines.\n2. Update `live-log.tsx` to use `mergeLines`, stop applying a response after effect cleanup, and advance the cursor with `Math.max`.\n3. Add `live-log-lines.test.ts` covering repeated ids from overlapping polls, duplicate ids inside one batch, the 1000-line cap, and the no-op case.\n4. Verify with the unit test, Biome, web typecheck, then `run_checks`.",
  "findings": [
    "triage: Ticket is clear: React duplicate keys in live-log.tsx when rendering job event lines; acceptance is no console error on the job detail page.",
    "investigating: Found the cause: the polling effect in live-log.tsx is invoked twice by React Strict Mode in dev, and the first loop still appends its response after cleanup, so the same events (ids 4294/4295) are merged twice. Plan recorded.",
    "implementing: Implemented dedupe in mergeLines plus a stale-poll guard in LiveLog. Unit tests pass, Biome clean, web typecheck passes, and a Playwright harness reproduced the exact 4294/4295 duplicate-key errors with the old logic while the fixed code renders two lines with no console errors."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T07:01:47.996Z"
}
```
