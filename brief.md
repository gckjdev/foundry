# Handoff brief: set job max execution time in UI

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T00:56:10.691Z

## Plan

## Plan: per-job max execution time

1. **DB** — add nullable `jobs.max_job_minutes` (integer) in `packages/db/src/schema.ts`; migration `packages/db/migrations/0004_job_max_minutes.sql` + journal entry. Null means "follow repo policy" so existing jobs keep current behavior; `policy.max_job_minutes` already defaults to 60.
2. **Shared** — `ClaimedJobSchema` gains `maxJobMinutes` (nullable override) and `HeartbeatResponseSchema` gains `jobLimits: [{jobId, maxJobMinutes}]`. Add `effectiveMaxJobMinutes(override, policy)` helper in `packages/shared/src/policy.ts`.
3. **Control** — `claimJob` returns the override; `heartbeat` reports each owned job's override so runners can react live; new `setJobMaxMinutes(ctx, teamId, jobId, minutes)` in `packages/control/src/jobs.ts` (validates, team-scoped, bumps `updatedAt`).
4. **Web** — `setMaxMinutesAction` in `apps/web/src/app/actions.ts`; a "Job limits" card on `apps/web/src/app/(panel)/jobs/[id]/page.tsx` with a minutes number input defaulting to the effective value (override ?? `repoPolicy(repo).max_job_minutes`, policy default 60), editable in every job state including while running.
5. **Runner** — `JobRunner` computes the effective limit after loading policy, arms a re-armable deadline in `drive()`, and exposes `setMaxJobMinutes(override)`; `Daemon.tick()` applies `heartbeat.jobLimits` to each running runner. Lowering the limit mid-run re-arms the timer; if already past, the job fails with a budget message.
6. **Tests** — control: setter persists/team-scopes and heartbeat returns `jobLimits`; runner: job fails when its own limit is lowered below elapsed time (plus fixture update). Run biome, typecheck, and the targeted Vitest files.
7. **Verify** — `run_checks`, then screenshot the job detail page for evidence.

## Findings

- triage: Ticket is clear: expose a per-job max execution time on the job detail page. Found the existing repo-level `policy.max_job_minutes` (default 60) enforced by a timeout in the runner's drive loop, the job detail page/actions, the jobs schema, and the heartbeat channel the runner could use to learn live changes.
- investigating: Plan recorded: nullable per-job override on jobs, surfaced through claim/heartbeat, editable from the job detail page, and enforced live by the runner daemon.
- implementing: Implemented the per-job limit end to end (schema+migration, claim/heartbeat plumbing, control setter, job-page form, runner deadline re-arming). Targeted tests, typecheck, and a browser round-trip (saved 90 minutes and saw it persist) pass.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "95dd2dc4-5e44-4196-9ed7-cef462cb7f93",
  "title": "set job max execution time in UI",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "cb901b68-ccf6-4199-a5d0-6c239799e4f6",
  "plan": "## Plan: per-job max execution time\n\n1. **DB** — add nullable `jobs.max_job_minutes` (integer) in `packages/db/src/schema.ts`; migration `packages/db/migrations/0004_job_max_minutes.sql` + journal entry. Null means \"follow repo policy\" so existing jobs keep current behavior; `policy.max_job_minutes` already defaults to 60.\n2. **Shared** — `ClaimedJobSchema` gains `maxJobMinutes` (nullable override) and `HeartbeatResponseSchema` gains `jobLimits: [{jobId, maxJobMinutes}]`. Add `effectiveMaxJobMinutes(override, policy)` helper in `packages/shared/src/policy.ts`.\n3. **Control** — `claimJob` returns the override; `heartbeat` reports each owned job's override so runners can react live; new `setJobMaxMinutes(ctx, teamId, jobId, minutes)` in `packages/control/src/jobs.ts` (validates, team-scoped, bumps `updatedAt`).\n4. **Web** — `setMaxMinutesAction` in `apps/web/src/app/actions.ts`; a \"Job limits\" card on `apps/web/src/app/(panel)/jobs/[id]/page.tsx` with a minutes number input defaulting to the effective value (override ?? `repoPolicy(repo).max_job_minutes`, policy default 60), editable in every job state including while running.\n5. **Runner** — `JobRunner` computes the effective limit after loading policy, arms a re-armable deadline in `drive()`, and exposes `setMaxJobMinutes(override)`; `Daemon.tick()` applies `heartbeat.jobLimits` to each running runner. Lowering the limit mid-run re-arms the timer; if already past, the job fails with a budget message.\n6. **Tests** — control: setter persists/team-scopes and heartbeat returns `jobLimits`; runner: job fails when its own limit is lowered below elapsed time (plus fixture update). Run biome, typecheck, and the targeted Vitest files.\n7. **Verify** — `run_checks`, then screenshot the job detail page for evidence.",
  "findings": [
    "triage: Ticket is clear: expose a per-job max execution time on the job detail page. Found the existing repo-level `policy.max_job_minutes` (default 60) enforced by a timeout in the runner's drive loop, the job detail page/actions, the jobs schema, and the heartbeat channel the runner could use to learn live changes.",
    "investigating: Plan recorded: nullable per-job override on jobs, surfaced through claim/heartbeat, editable from the job detail page, and enforced live by the runner daemon.",
    "implementing: Implemented the per-job limit end to end (schema+migration, claim/heartbeat plumbing, control setter, job-page form, runner deadline re-arming). Targeted tests, typecheck, and a browser round-trip (saved 90 minutes and saw it persist) pass."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T00:56:10.691Z"
}
```
