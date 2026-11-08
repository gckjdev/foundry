# Handoff brief: Fix bug: Job shows twice in board if cancelled then retry

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T02:56:35.609Z

## Plan

Root cause (reproduced against a throwaway Postgres):
- Cancelling a job leaves the `foundry` trigger label on the GitHub issue.
- `reconcileLabeledIssues` (run on every board/inbox load and every 30s by the worker) only checks `activeJobForIssue`, which excludes `cancelled`, so it creates a second job for the same issue.
- The board then renders both the old cancelled job (Stopped) and the new queued job (Queued). Retrying the original job hits the partial unique index on (repo_id, issue_number) and fails.

Plan:
1. `packages/control/src/jobs.ts`: in `reconcileLabeledIssues`, skip issues that already have a job (including cancelled) instead of only active ones, so a lingering trigger label never auto-restarts cancelled work. Keep the explicit `issues.labeled` webhook path able to create a fresh job.
2. `packages/control/src/queries.ts`: make `boardJobs` collapse to one row per issue (repo + issue number), preferring the live/non-stopped job, as a safety net for existing duplicate rows and deliberate re-labels. This enforces the acceptance criterion directly.
3. Tests: add a control test (cancel → reconcile creates nothing → retry re-queues the same job) and a board test (cancelled + active rows for one issue render once, in the active lane).


## Findings

- triage: Found and reproduced the root cause: `reconcileLabeledIssues` treats a cancelled job as absent, so the lingering `foundry` trigger label spawns a duplicate active job for the same issue; the board then shows the issue in both Stopped and Queued, and retrying the cancelled job collides with the partial unique index.
- investigating: Implementing the reconcile guard plus per-issue board dedupe, with regression tests for cancel→retry and duplicate display.
- implementing: Recipe checks lint, typecheck and test all passed, and the full Vitest suite passed with a throwaway Postgres (188 tests). Regression tests cover the cancel→retry flow and one-card-per-issue board rendering.
- implementing: Merged origin/main into the fix branch and resolved the single conflict in packages/control/src/control.test.ts by unioning imports from both sides. The fix for the duplicate board card is unchanged; the merged tree now includes main's newer changes. Running the recipe checks on the merged result.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

- A deliberate re-label (`foundry` removed then re-added) after a cancel still creates a fresh job via the webhook path; the board now hides the older cancelled card for that issue. The webhook path was intentionally left able to start a new job.

```json
{
  "version": 1,
  "jobId": "e4c685d1-b5be-4d2c-b353-13544137dbd5",
  "title": "Fix bug: Job shows twice in board if cancelled then retry",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "6addf392-8ab7-4cb9-b93c-22c7eb205675",
  "plan": "Root cause (reproduced against a throwaway Postgres):\n- Cancelling a job leaves the `foundry` trigger label on the GitHub issue.\n- `reconcileLabeledIssues` (run on every board/inbox load and every 30s by the worker) only checks `activeJobForIssue`, which excludes `cancelled`, so it creates a second job for the same issue.\n- The board then renders both the old cancelled job (Stopped) and the new queued job (Queued). Retrying the original job hits the partial unique index on (repo_id, issue_number) and fails.\n\nPlan:\n1. `packages/control/src/jobs.ts`: in `reconcileLabeledIssues`, skip issues that already have a job (including cancelled) instead of only active ones, so a lingering trigger label never auto-restarts cancelled work. Keep the explicit `issues.labeled` webhook path able to create a fresh job.\n2. `packages/control/src/queries.ts`: make `boardJobs` collapse to one row per issue (repo + issue number), preferring the live/non-stopped job, as a safety net for existing duplicate rows and deliberate re-labels. This enforces the acceptance criterion directly.\n3. Tests: add a control test (cancel → reconcile creates nothing → retry re-queues the same job) and a board test (cancelled + active rows for one issue render once, in the active lane).\n",
  "findings": [
    "triage: Found and reproduced the root cause: `reconcileLabeledIssues` treats a cancelled job as absent, so the lingering `foundry` trigger label spawns a duplicate active job for the same issue; the board then shows the issue in both Stopped and Queued, and retrying the cancelled job collides with the partial unique index.",
    "investigating: Implementing the reconcile guard plus per-issue board dedupe, with regression tests for cancel→retry and duplicate display.",
    "implementing: Recipe checks lint, typecheck and test all passed, and the full Vitest suite passed with a throwaway Postgres (188 tests). Regression tests cover the cancel→retry flow and one-card-per-issue board rendering.",
    "implementing: Merged origin/main into the fix branch and resolved the single conflict in packages/control/src/control.test.ts by unioning imports from both sides. The fix for the duplicate board card is unchanged; the merged tree now includes main's newer changes. Running the recipe checks on the merged result."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [
    "A deliberate re-label (`foundry` removed then re-added) after a cancel still creates a fresh job via the webhook path; the board now hides the older cancelled card for that issue. The webhook path was intentionally left able to start a new job."
  ],
  "updatedAt": "2026-11-08T02:56:35.609Z"
}
```
