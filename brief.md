# Handoff brief: Fix bug

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T00:21:08.431Z

## Plan

## Plan

1. **`apps/web/src/app/(panel)/jobs/[id]/page.tsx`** — make the `gate.failed` list key unique by combining the rule name with the array index (`${f.rule}-${i}`), since `evaluateGate` legitimately emits multiple entries with the same `rule` (one per risk match, line 87-89 of `packages/shared/src/gate.ts`).
2. Run `biome check --write` on the touched file, then `run_checks` (typecheck/lint/tests).
3. If feasible, render the job page in the dev server on `$FOUNDRY_PORT` to confirm the console error is gone; otherwise attach a note explaining the DB/auth setup required.

No other component renders `gate.failed`, so this is a one-site fix. No change to the gate logic: multiple risk-rule failures are intentional.

## Findings

- triage: Ticket #32 is a clear UI bug: the job page renders `gate.failed` items with `key={f.rule}`, but the list can contain multiple failures for the same rule (e.g. two `risk_rules`), producing duplicate React keys and the console error. Acceptance criterion is that the console error disappears.
- investigating: Found the only render site of `gate.failed` and confirmed duplicates are expected from the gate (one failure per risk match). The fix is confined to the list key on the job detail page.
- implementing: Changed the `gate.failed` list key from `f.rule` to `rule + detail`, which is unique per failure (the duplicated entries are distinct risk rules whose names appear in the detail). Biome passes; an index-based key was rejected by `noArrayIndexKey`.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "3a2d6b9b-77e0-4ff9-9caf-3b428979bf9d",
  "title": "Fix bug",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "490f7149-8cdb-43d1-9a69-b29fd0ce5b06",
  "plan": "## Plan\n\n1. **`apps/web/src/app/(panel)/jobs/[id]/page.tsx`** — make the `gate.failed` list key unique by combining the rule name with the array index (`${f.rule}-${i}`), since `evaluateGate` legitimately emits multiple entries with the same `rule` (one per risk match, line 87-89 of `packages/shared/src/gate.ts`).\n2. Run `biome check --write` on the touched file, then `run_checks` (typecheck/lint/tests).\n3. If feasible, render the job page in the dev server on `$FOUNDRY_PORT` to confirm the console error is gone; otherwise attach a note explaining the DB/auth setup required.\n\nNo other component renders `gate.failed`, so this is a one-site fix. No change to the gate logic: multiple risk-rule failures are intentional.",
  "findings": [
    "triage: Ticket #32 is a clear UI bug: the job page renders `gate.failed` items with `key={f.rule}`, but the list can contain multiple failures for the same rule (e.g. two `risk_rules`), producing duplicate React keys and the console error. Acceptance criterion is that the console error disappears.",
    "investigating: Found the only render site of `gate.failed` and confirmed duplicates are expected from the gate (one failure per risk match). The fix is confined to the list key on the job detail page.",
    "implementing: Changed the `gate.failed` list key from `f.rule` to `rule + detail`, which is unique per failure (the duplicated entries are distinct risk rules whose names appear in the detail). Biome passes; an index-based key was rejected by `noArrayIndexKey`."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T00:21:08.431Z"
}
```
