# Handoff brief: Fix bug: after PR is raised and 'Request Change' is submitted back, the job doens't run automatically to fix the request changes

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T01:58:28.021Z

## Plan

## Problem

Ticket #42: a reviewer submits "Request changes" on a Foundry PR and the job never runs again.
The `pull_request_review` webhook handler in `packages/control/src/ingest.ts` already re-queues correctly (covered by a test), but the live example job (`e4c685d1…`, PR #40) shows **zero** `pull_request_review` rows in `webhook_inbox`; GitHub's App delivery log has the event accepted by smee at 09:14, but the local `dev:webhooks` tunnel never forwarded it. Merged-PR handling has a catch-up reconcile (`reconcileOpenPullRequests`), changes-requested reviews do not — so a missed webhook leaves the job stuck in `waiting_on_you` forever.

## Plan

1. `packages/db/src/schema.ts` + `packages/db/migrations/0005_last_review_id.sql`: add nullable `jobs.last_review_id` so a review is acted on exactly once (idempotent polling).
2. `packages/control/src/merge-gate.ts`:
   - `handleChangesRequestedReview(ctx, job, review)` — atomically claims `last_review_id`, then `sendMessage` with the review body (fallback text when empty). Shared by webhook + poll.
   - `syncChangesRequestedReview(ctx, job)` — for `pr_ci` / `waiting_on_you` jobs with a PR, list reviews, take each non-bot author's latest, and act on a `CHANGES_REQUESTED` review that hasn't been handled.
   - `reconcileChangesRequestedReviews(ctx)` — loop over open-PR jobs (mirrors `reconcileOpenPullRequests`).
3. `packages/control/src/ingest.ts`: include `review.id` in the payload; route human changes-requested reviews through `handleChangesRequestedReview` so webhook and poll share dedupe.
4. `packages/control/src/worker.ts`: call `reconcileChangesRequestedReviews` on each 30 s tick.
5. `packages/control/src/queries.ts` (`jobDetail`): also run `syncChangesRequestedReview`, like the existing `syncMergedPullRequest` page-open catch-up.
6. Tests in `packages/control/src/control.test.ts`: poll re-queues a `waiting_on_you` job from a GitHub review, is idempotent on a second poll, and ignores bot/approved reviews.

## Out of scope

No changes to GitHub App config, playbooks, or the runner.


## Findings

- triage: Ticket #42 is clear: a reviewer submitting "Request Changes" on a Foundry PR should re-trigger the job so the agent addresses the requested changes. Investigating how GitHub webhooks currently map to job lifecycle.
- investigating: Root cause: the changes-requested review webhook never reached the control plane (smee tunnel down at 09:14); the webhook handler itself works, but there is no catch-up poll like the one for merged PRs. Implementing an idempotent review reconciliation driven by a new jobs.last_review_id column.
- implementing: Implemented an idempotent changes-requested review catch-up: new jobs.last_review_id column (migration 0005), shared handler used by the webhook and a 30s worker reconcile, wired into jobDetail. Targeted control tests (13) and typecheck for control/db pass.
- implementing: Merged origin/main into the fix branch, resolving the parallel 0005 migration conflict by renumbering last_review_id to 0006 and keeping both the new max-cost and review catch-up imports. Targeted control tests (14) and db/control typecheck pass.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "0847a574-534f-4202-92d4-f5c5527a92dd",
  "title": "Fix bug: after PR is raised and 'Request Change' is submitted back, the job doens't run automatically to fix the request changes",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "01042923-e138-4aaa-8089-ad94a3f01ec6",
  "plan": "## Problem\n\nTicket #42: a reviewer submits \"Request changes\" on a Foundry PR and the job never runs again.\nThe `pull_request_review` webhook handler in `packages/control/src/ingest.ts` already re-queues correctly (covered by a test), but the live example job (`e4c685d1…`, PR #40) shows **zero** `pull_request_review` rows in `webhook_inbox`; GitHub's App delivery log has the event accepted by smee at 09:14, but the local `dev:webhooks` tunnel never forwarded it. Merged-PR handling has a catch-up reconcile (`reconcileOpenPullRequests`), changes-requested reviews do not — so a missed webhook leaves the job stuck in `waiting_on_you` forever.\n\n## Plan\n\n1. `packages/db/src/schema.ts` + `packages/db/migrations/0005_last_review_id.sql`: add nullable `jobs.last_review_id` so a review is acted on exactly once (idempotent polling).\n2. `packages/control/src/merge-gate.ts`:\n   - `handleChangesRequestedReview(ctx, job, review)` — atomically claims `last_review_id`, then `sendMessage` with the review body (fallback text when empty). Shared by webhook + poll.\n   - `syncChangesRequestedReview(ctx, job)` — for `pr_ci` / `waiting_on_you` jobs with a PR, list reviews, take each non-bot author's latest, and act on a `CHANGES_REQUESTED` review that hasn't been handled.\n   - `reconcileChangesRequestedReviews(ctx)` — loop over open-PR jobs (mirrors `reconcileOpenPullRequests`).\n3. `packages/control/src/ingest.ts`: include `review.id` in the payload; route human changes-requested reviews through `handleChangesRequestedReview` so webhook and poll share dedupe.\n4. `packages/control/src/worker.ts`: call `reconcileChangesRequestedReviews` on each 30 s tick.\n5. `packages/control/src/queries.ts` (`jobDetail`): also run `syncChangesRequestedReview`, like the existing `syncMergedPullRequest` page-open catch-up.\n6. Tests in `packages/control/src/control.test.ts`: poll re-queues a `waiting_on_you` job from a GitHub review, is idempotent on a second poll, and ignores bot/approved reviews.\n\n## Out of scope\n\nNo changes to GitHub App config, playbooks, or the runner.\n",
  "findings": [
    "triage: Ticket #42 is clear: a reviewer submitting \"Request Changes\" on a Foundry PR should re-trigger the job so the agent addresses the requested changes. Investigating how GitHub webhooks currently map to job lifecycle.",
    "investigating: Root cause: the changes-requested review webhook never reached the control plane (smee tunnel down at 09:14); the webhook handler itself works, but there is no catch-up poll like the one for merged PRs. Implementing an idempotent review reconciliation driven by a new jobs.last_review_id column.",
    "implementing: Implemented an idempotent changes-requested review catch-up: new jobs.last_review_id column (migration 0005), shared handler used by the webhook and a 30s worker reconcile, wired into jobDetail. Targeted control tests (13) and typecheck for control/db pass.",
    "implementing: Merged origin/main into the fix branch, resolving the parallel 0005 migration conflict by renumbering last_review_id to 0006 and keeping both the new max-cost and review catch-up imports. Targeted control tests (14) and db/control typecheck pass."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T01:58:28.021Z"
}
```
