# Handoff brief: Fix bug: a github issue is closed (PR merged) but it's still in WORKING status for some reason

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T03:25:26.113Z

## Plan

## Root cause

Issue #38 was closed by PR #40 at 03:02:52. Three seconds later job `ff226447` was created from that **closed** issue and claimed into `investigating`; no further `issues.closed` event will ever arrive, so it stays under the board's **Working** lane forever.

Two holes let this happen:
1. `issues.labeled` (and `reconcileLabeledIssues`) start a job from a label without checking the issue is still open. A late label/reconcile race can start work on an already-closed issue.
2. The `issues.closed` webhook only cancels at delivery time. There is no catch-up for a missed/late close event (unlike merged PRs and requested changes), so any job that starts after the issue closes is never stopped.

## Plan

1. `packages/control/src/ingest.ts`
   - Parse `issue.state` from the webhook and never create a job for a `closed` issue in the `issues.labeled` branch.
   - In the `issues.closed` branch, look the job up by `issueNumber` (`activeJobForIssue`) instead of `issueNumber OR prNumber`, so the right job is stopped (keeping the existing `pr_ci` exception so merge can be recorded as merged).
2. `packages/control/src/merge-gate.ts`
   - Add `syncClosedIssue(ctx, job)`: if the source issue is closed, cancel the job (except `pr_ci`/`waiting_on_you` whose PR is already merged, which must stay on the merge path).
   - Add `reconcileClosedIssues(ctx)`: catch-up over all active jobs, for missed webhooks.
3. `packages/control/src/worker.ts` — run `reconcileClosedIssues` in the 30s sweep (after the merged-PR reconcile).
4. `packages/control/src/queries.ts` — `jobDetail` calls `syncClosedIssue`, so opening a stuck job page heals it too.
5. `packages/control/src/jobs.ts` — defensive `issue.state === "open"` check in `reconcileLabeledIssues`.
6. Tests in `packages/control/src/control.test.ts` + `packages/control/src/testing.ts` payload helper:
   - a labeled webhook for a closed issue creates no job;
   - a working job whose issue closes (webhook missed) is cancelled by `reconcileClosedIssues`;
   - a `pr_ci` job whose PR is already merged is not cancelled.

Verification: start a throwaway local Postgres on a FOUNDRY_PORT, run the control test file, then `run_checks` (lint, typecheck, tests).

## Findings

- investigating: Root cause: a job can be created from an already-closed issue, and there is no catch-up for a missed issues.closed webhook, so the new job runs forever. Implementing a creation guard plus a closed-issue reconcile/catch-up.
- implementing: Implemented: closed issues can no longer start a job (webhook + reconcile), `issues.closed` now matches the job by issue number, and a new `syncClosedIssue`/`reconcileClosedIssues` catch-up cancels active jobs when their source issue is closed (worker tick + job page), while leaving merged-PR jobs on the merge path. Added 4 DB-backed control tests; control tests pass and lint/typecheck are clean.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "4b92bfd1-d931-485b-b0b5-76cd6a1321bb",
  "title": "Fix bug: a github issue is closed (PR merged) but it's still in WORKING status for some reason",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "7764a5e6-b8e8-41ff-8c4b-11960a4fdfca",
  "plan": "## Root cause\n\nIssue #38 was closed by PR #40 at 03:02:52. Three seconds later job `ff226447` was created from that **closed** issue and claimed into `investigating`; no further `issues.closed` event will ever arrive, so it stays under the board's **Working** lane forever.\n\nTwo holes let this happen:\n1. `issues.labeled` (and `reconcileLabeledIssues`) start a job from a label without checking the issue is still open. A late label/reconcile race can start work on an already-closed issue.\n2. The `issues.closed` webhook only cancels at delivery time. There is no catch-up for a missed/late close event (unlike merged PRs and requested changes), so any job that starts after the issue closes is never stopped.\n\n## Plan\n\n1. `packages/control/src/ingest.ts`\n   - Parse `issue.state` from the webhook and never create a job for a `closed` issue in the `issues.labeled` branch.\n   - In the `issues.closed` branch, look the job up by `issueNumber` (`activeJobForIssue`) instead of `issueNumber OR prNumber`, so the right job is stopped (keeping the existing `pr_ci` exception so merge can be recorded as merged).\n2. `packages/control/src/merge-gate.ts`\n   - Add `syncClosedIssue(ctx, job)`: if the source issue is closed, cancel the job (except `pr_ci`/`waiting_on_you` whose PR is already merged, which must stay on the merge path).\n   - Add `reconcileClosedIssues(ctx)`: catch-up over all active jobs, for missed webhooks.\n3. `packages/control/src/worker.ts` — run `reconcileClosedIssues` in the 30s sweep (after the merged-PR reconcile).\n4. `packages/control/src/queries.ts` — `jobDetail` calls `syncClosedIssue`, so opening a stuck job page heals it too.\n5. `packages/control/src/jobs.ts` — defensive `issue.state === \"open\"` check in `reconcileLabeledIssues`.\n6. Tests in `packages/control/src/control.test.ts` + `packages/control/src/testing.ts` payload helper:\n   - a labeled webhook for a closed issue creates no job;\n   - a working job whose issue closes (webhook missed) is cancelled by `reconcileClosedIssues`;\n   - a `pr_ci` job whose PR is already merged is not cancelled.\n\nVerification: start a throwaway local Postgres on a FOUNDRY_PORT, run the control test file, then `run_checks` (lint, typecheck, tests).",
  "findings": [
    "investigating: Root cause: a job can be created from an already-closed issue, and there is no catch-up for a missed issues.closed webhook, so the new job runs forever. Implementing a creation guard plus a closed-issue reconcile/catch-up.",
    "implementing: Implemented: closed issues can no longer start a job (webhook + reconcile), `issues.closed` now matches the job by issue number, and a new `syncClosedIssue`/`reconcileClosedIssues` catch-up cancels active jobs when their source issue is closed (worker tick + job page), while leaving merged-PR jobs on the merge path. Added 4 DB-backed control tests; control tests pass and lint/typecheck are clean."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T03:25:26.113Z"
}
```
