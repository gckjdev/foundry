# Handoff brief: Fix bug: Max Execution Time not able to save in Job limit page

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T08:16:13.916Z

## Plan

Revised requirement from @gckjdev: one Save button for both job limits.

1. `apps/web/src/app/actions.ts` — replace `maxMinutesAction` + `maxCostAction` with one `jobLimitsAction` that validates and persists both fields in one submit (empty clears that override; invalid input saves neither).
2. `apps/web/src/app/(panel)/jobs/[id]/configuration/page.tsx` — render one form with both number inputs and a single Save button.
3. `apps/web/src/app/(panel)/jobs/[id]/configuration/limits.ts` — replace the two form keys with one `limitsKey` derived from both persisted values so a save remounts the uncontrolled fields with what was written.
4. Update `limits.test.ts` and `tests/api/job-configuration.test.ts` for the merged form: saving either/both fields, clearing one, invalid input is all-or-nothing.
5. Re-verify in a real browser (fill both, one Save, back → configuration shows persisted values), replace stale evidence screenshots, then run recipe checks.

## Findings

- triage: Traced the job configuration page and its server actions. The DB write path (setJobMaxMinutes/setJobMaxCost) is correct and covered. The page renders uncontrolled inputs (defaultValue) inside server-action forms, so the fields can keep browser-held values instead of the persisted ones — the same stale-field class already fixed on the repos page in PR #65. Read the real dev DB and dev log to confirm the page/action wiring, but could not reproduce a persistence failure end-to-end.
- investigating: Implemented the helper + form remount keys, the unit test, and the API test that exercises the real save actions against a test database. Added the next/cache Vitest shim so server actions run in-process.
- implementing: Browser-verified save → back → configuration keeps the new max execution time (screenshots captured), and both new test files pass against a throwaway Postgres. Running the recipe checks now.
- implementing: Merged the two Job limits forms into one with a single Save button. The action now validates and persists both max minutes and max cost together (all-or-nothing), and a single form key remounts both uncontrolled fields after a save. Unit and DB-backed API tests were updated and pass; a browser run showed one Save button, 95/20 saved, and the same values after leaving and returning to the configuration page.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "a2ad3ae8-3cb1-4fbf-bbbf-67cec466402a",
  "title": "Fix bug: Max Execution Time not able to save in Job limit page",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "e2cb0895-b037-420b-9022-e361ebfe404b",
  "plan": "Revised requirement from @gckjdev: one Save button for both job limits.\n\n1. `apps/web/src/app/actions.ts` — replace `maxMinutesAction` + `maxCostAction` with one `jobLimitsAction` that validates and persists both fields in one submit (empty clears that override; invalid input saves neither).\n2. `apps/web/src/app/(panel)/jobs/[id]/configuration/page.tsx` — render one form with both number inputs and a single Save button.\n3. `apps/web/src/app/(panel)/jobs/[id]/configuration/limits.ts` — replace the two form keys with one `limitsKey` derived from both persisted values so a save remounts the uncontrolled fields with what was written.\n4. Update `limits.test.ts` and `tests/api/job-configuration.test.ts` for the merged form: saving either/both fields, clearing one, invalid input is all-or-nothing.\n5. Re-verify in a real browser (fill both, one Save, back → configuration shows persisted values), replace stale evidence screenshots, then run recipe checks.",
  "findings": [
    "triage: Traced the job configuration page and its server actions. The DB write path (setJobMaxMinutes/setJobMaxCost) is correct and covered. The page renders uncontrolled inputs (defaultValue) inside server-action forms, so the fields can keep browser-held values instead of the persisted ones — the same stale-field class already fixed on the repos page in PR #65. Read the real dev DB and dev log to confirm the page/action wiring, but could not reproduce a persistence failure end-to-end.",
    "investigating: Implemented the helper + form remount keys, the unit test, and the API test that exercises the real save actions against a test database. Added the next/cache Vitest shim so server actions run in-process.",
    "implementing: Browser-verified save → back → configuration keeps the new max execution time (screenshots captured), and both new test files pass against a throwaway Postgres. Running the recipe checks now.",
    "implementing: Merged the two Job limits forms into one with a single Save button. The action now validates and persists both max minutes and max cost together (all-or-nothing), and a single form key remounts both uncontrolled fields after a save. Unit and DB-backed API tests were updated and pass; a browser run showed one Save button, 95/20 saved, and the same values after leaving and returning to the configuration page."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T08:16:13.916Z"
}
```
