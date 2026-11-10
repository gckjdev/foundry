# Handoff brief: Fix bug: inbox page keeps refreshing

Stage reached: **implementing** · harness: claude-code · updated 2026-11-10T12:18:12.808Z

## Plan

Review of key-event coverage for board / inbox / runners, then tighten the filter and lock it in with tests.

1. `apps/web/src/components/realtime-tables.ts`
   - Add `questions.gh_comment_id` to `NOISE_COLUMNS`: `askQuestion` stores it right after inserting the question (which already refreshes), and the panel never renders it. `helpful` stays a refresh trigger because the job page shows it.
   - Fail open when an UPDATE arrives with an empty `columns` list. The realtime service normalizes a missing list to `[]`, so the current check silently dropped every UPDATE if the DB trigger could not report columns (older deployment/migration).
2. `apps/web/src/components/realtime-tables.test.ts`
   - Keep the board tests.
   - Add inbox key-event tests: question asked/answered, job moves/created/removed; noise tests for events, runner heartbeats, cost ticks and `gh_comment_id`-only question updates.
   - Add runners key-event tests: runner heartbeat/status update and job changes refresh; events do not.
   - Extend the "no column info" test to cover the `columns: []` payload the realtime service actually sends.
3. Verify with `pnpm exec biome check` on the two files, targeted Vitest, then `run_checks`. No UI change, so no screenshot needed.

## Findings

- investigating: Tightened the realtime key-event filter and covered the board/inbox/runners contract with tests: an UPDATE with an empty columns list now refreshes (the realtime service normalizes a missing list to [], so the old code silently dropped updates when the trigger could not report columns), and questions.gh_comment_id is noise (never rendered; the question INSERT already refreshed). Added inbox and runners key-event tests alongside the board ones.
- implementing: Implementation is complete. Targeted Vitest (realtime-tables + realtime server) passes 20/20 and Biome is clean on both touched files; running the repo recipe checks next.

## Checks

_not run_

## Questions and answers

- Q: I could not reproduce the inbox re-rendering with the current code. Instrumenting http://localhost:3000/inbox while a job is running: it made 0 realtime re-renders in 60s and 0 DOM updates in 20s — it already ignores agent event rows, runner heartbeats and cost-only job updates, so it behaves like /board. To fix the right thing, which best describes what you see?
  A: it seems okay now, pls review the key events to make sure the board/inbox/runner page refresh properly

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "5f24bd70-5332-452c-850d-410f4bf31586",
  "title": "Fix bug: inbox page keeps refreshing",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "178153a2-1c93-4a3d-ad10-16bf9d4b7f1f",
  "plan": "Review of key-event coverage for board / inbox / runners, then tighten the filter and lock it in with tests.\n\n1. `apps/web/src/components/realtime-tables.ts`\n   - Add `questions.gh_comment_id` to `NOISE_COLUMNS`: `askQuestion` stores it right after inserting the question (which already refreshes), and the panel never renders it. `helpful` stays a refresh trigger because the job page shows it.\n   - Fail open when an UPDATE arrives with an empty `columns` list. The realtime service normalizes a missing list to `[]`, so the current check silently dropped every UPDATE if the DB trigger could not report columns (older deployment/migration).\n2. `apps/web/src/components/realtime-tables.test.ts`\n   - Keep the board tests.\n   - Add inbox key-event tests: question asked/answered, job moves/created/removed; noise tests for events, runner heartbeats, cost ticks and `gh_comment_id`-only question updates.\n   - Add runners key-event tests: runner heartbeat/status update and job changes refresh; events do not.\n   - Extend the \"no column info\" test to cover the `columns: []` payload the realtime service actually sends.\n3. Verify with `pnpm exec biome check` on the two files, targeted Vitest, then `run_checks`. No UI change, so no screenshot needed.",
  "findings": [
    "investigating: Tightened the realtime key-event filter and covered the board/inbox/runners contract with tests: an UPDATE with an empty columns list now refreshes (the realtime service normalizes a missing list to [], so the old code silently dropped updates when the trigger could not report columns), and questions.gh_comment_id is noise (never rendered; the question INSERT already refreshed). Added inbox and runners key-event tests alongside the board ones.",
    "implementing: Implementation is complete. Targeted Vitest (realtime-tables + realtime server) passes 20/20 and Biome is clean on both touched files; running the repo recipe checks next."
  ],
  "checks": [],
  "qa": [
    {
      "question": "I could not reproduce the inbox re-rendering with the current code. Instrumenting http://localhost:3000/inbox while a job is running: it made 0 realtime re-renders in 60s and 0 DOM updates in 20s — it already ignores agent event rows, runner heartbeats and cost-only job updates, so it behaves like /board. To fix the right thing, which best describes what you see?",
      "answer": "it seems okay now, pls review the key events to make sure the board/inbox/runner page refresh properly"
    }
  ],
  "uncertainties": [],
  "updatedAt": "2026-11-10T12:18:12.808Z"
}
```
