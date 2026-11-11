# Handoff brief: Show execution time for each job

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-11T23:27:04.358Z

## Plan

## Plan: show execution time per job

1. **`apps/web/src/components/duration.ts`** (new, pure/testable): add `elapsed(start, end)` that formats wall-clock duration (`45s`, `12m`, `3h 12m`, `2d 3h`) and `jobElapsed({status, startedAt, finishedAt, updatedAt})` which ends at `finishedAt ?? updatedAt` for merged/failed/cancelled jobs and at "now" for in-flight jobs; queued jobs that never started render `—`.
2. **`packages/control/src/queries.ts`**: add `startedAt` and `finishedAt` to `BOARD_JOB_COLUMNS` so the board card can read them without pulling issue bodies/plans.
3. **`apps/web/src/app/(panel)/board/page.tsx`**: show `jobElapsed(job)` in the ticket meta row next to cost.
4. **`apps/web/src/app/(panel)/jobs/[id]/page.tsx`**: add elapsed time to the header row (after cost), per spec 5.x job-detail header.
5. **Tests**: `apps/web/src/components/duration.test.ts` for formatting/ended/in-flight/not-started cases; extend `packages/control/src/surfaces.test.ts` so the board read path is proven to return the new timestamps.
6. Run biome, typecheck, and the affected vitest files; then full recipe checks. Screenshot the board/job detail if the dev server can boot with a seeded DB.


## Findings

- triage: Ticket #91 is clear: show each job's execution (elapsed) time on the board cards and the job detail header. The jobs table already records startedAt (first runner claim) and finishedAt (merged/cancelled/failed), so this is a read-path + display change; no schema work needed.
- investigating: Found the board read path (`packages/control/src/queries.ts` BOARD_JOB_COLUMNS), the board card markup, and the job detail header. The jobs table already tracks startedAt/finishedAt; the existing `ago` formatter lives in `apps/web/src/components/status.tsx`. No schema or status changes needed.
- implementing: Implemented execution-time display: new `duration.ts` helper with unit tests, board cards show elapsed time next to cost, the job detail header shows it after cost, and `boardJobs` now selects startedAt/finishedAt with a surface test covering them. Biome, web/control typecheck, and the duration unit test pass locally.
- review: Reviewed the full diff against origin/main (`apps/web/src/components/duration.ts` + tests, board page, job detail page, `packages/control/src/queries.ts`, `packages/control/src/surfaces.test.ts`).

**Code quality — checked, no blocking issues.** Both acceptance-criteria surfaces are covered: board cards (`board/page.tsx:66-68`) and the job-detail header (`jobs/[id]/page.tsx:99-101`), the latter matching spec 5.x ("cost, elapsed time"). `startedAt`/`finishedAt` are set on claim and on transitions to merged/cancelled/failed (`claim.ts:117`, `jobs.ts:130-131`), and `updatedAt` is reliably refreshed by the `jobs_touch` DB trigger, so the helper's inputs are sound. The new `BOARD_JOB_COLUMNS` entries are read-only, `BoardJobRow` has no other consumers, and the `surfaces.test.ts` assertion genuinely fails without the query change. Unit tests cover formatting, the clamping case, stopped/running/no-finish/no-start paths; the retry case is pinned explicitly. No debug leftovers, no scope creep, no new dependencies.

**UI design — checked.** Uses existing `.ticket-meta` / `.dim` classes and the established `— · $0.xx` separator pattern; no new tokens or invented styles; the header row is `flex-wrap`, so the extra span cannot overflow. No screenshot was attached to the review checkout (the verify stage will capture the final ones), so layout was assessed from the markup and CSS only.

**Security — not applicable in any meaningful way.** Read-only display of two existing columns, no new input, auth, SQL or dependency surface.

Verified statically (per the read-only review contract, I did not run builds/tests): the test expectations match the implementation arithmetic, Vitest's fake timers do fake `Date` (same pattern as `job-runner.test.ts:616`), and the files conform to Biome's line width/quoting style. Findings below are suggestions only.
- reviewing: Reviewer approved. Moving to verification: full recipe checks, then a screenshot of the board/job detail if the control plane can boot with a local Postgres.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "d0668f9f-80e8-48d8-8ce0-0680371acb47",
  "title": "Show execution time for each job",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "3ea6d03f-bf47-442c-8813-5585b97ff634",
  "plan": "## Plan: show execution time per job\n\n1. **`apps/web/src/components/duration.ts`** (new, pure/testable): add `elapsed(start, end)` that formats wall-clock duration (`45s`, `12m`, `3h 12m`, `2d 3h`) and `jobElapsed({status, startedAt, finishedAt, updatedAt})` which ends at `finishedAt ?? updatedAt` for merged/failed/cancelled jobs and at \"now\" for in-flight jobs; queued jobs that never started render `—`.\n2. **`packages/control/src/queries.ts`**: add `startedAt` and `finishedAt` to `BOARD_JOB_COLUMNS` so the board card can read them without pulling issue bodies/plans.\n3. **`apps/web/src/app/(panel)/board/page.tsx`**: show `jobElapsed(job)` in the ticket meta row next to cost.\n4. **`apps/web/src/app/(panel)/jobs/[id]/page.tsx`**: add elapsed time to the header row (after cost), per spec 5.x job-detail header.\n5. **Tests**: `apps/web/src/components/duration.test.ts` for formatting/ended/in-flight/not-started cases; extend `packages/control/src/surfaces.test.ts` so the board read path is proven to return the new timestamps.\n6. Run biome, typecheck, and the affected vitest files; then full recipe checks. Screenshot the board/job detail if the dev server can boot with a seeded DB.\n",
  "findings": [
    "triage: Ticket #91 is clear: show each job's execution (elapsed) time on the board cards and the job detail header. The jobs table already records startedAt (first runner claim) and finishedAt (merged/cancelled/failed), so this is a read-path + display change; no schema work needed.",
    "investigating: Found the board read path (`packages/control/src/queries.ts` BOARD_JOB_COLUMNS), the board card markup, and the job detail header. The jobs table already tracks startedAt/finishedAt; the existing `ago` formatter lives in `apps/web/src/components/status.tsx`. No schema or status changes needed.",
    "implementing: Implemented execution-time display: new `duration.ts` helper with unit tests, board cards show elapsed time next to cost, the job detail header shows it after cost, and `boardJobs` now selects startedAt/finishedAt with a surface test covering them. Biome, web/control typecheck, and the duration unit test pass locally.",
    "review: Reviewed the full diff against origin/main (`apps/web/src/components/duration.ts` + tests, board page, job detail page, `packages/control/src/queries.ts`, `packages/control/src/surfaces.test.ts`).\n\n**Code quality — checked, no blocking issues.** Both acceptance-criteria surfaces are covered: board cards (`board/page.tsx:66-68`) and the job-detail header (`jobs/[id]/page.tsx:99-101`), the latter matching spec 5.x (\"cost, elapsed time\"). `startedAt`/`finishedAt` are set on claim and on transitions to merged/cancelled/failed (`claim.ts:117`, `jobs.ts:130-131`), and `updatedAt` is reliably refreshed by the `jobs_touch` DB trigger, so the helper's inputs are sound. The new `BOARD_JOB_COLUMNS` entries are read-only, `BoardJobRow` has no other consumers, and the `surfaces.test.ts` assertion genuinely fails without the query change. Unit tests cover formatting, the clamping case, stopped/running/no-finish/no-start paths; the retry case is pinned explicitly. No debug leftovers, no scope creep, no new dependencies.\n\n**UI design — checked.** Uses existing `.ticket-meta` / `.dim` classes and the established `— · $0.xx` separator pattern; no new tokens or invented styles; the header row is `flex-wrap`, so the extra span cannot overflow. No screenshot was attached to the review checkout (the verify stage will capture the final ones), so layout was assessed from the markup and CSS only.\n\n**Security — not applicable in any meaningful way.** Read-only display of two existing columns, no new input, auth, SQL or dependency surface.\n\nVerified statically (per the read-only review contract, I did not run builds/tests): the test expectations match the implementation arithmetic, Vitest's fake timers do fake `Date` (same pattern as `job-runner.test.ts:616`), and the files conform to Biome's line width/quoting style. Findings below are suggestions only.",
    "reviewing: Reviewer approved. Moving to verification: full recipe checks, then a screenshot of the board/job detail if the control plane can boot with a local Postgres."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-11T23:27:04.358Z"
}
```
