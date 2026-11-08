# Handoff brief: Make each job cost configurable in job detail page

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T01:43:44.102Z

## Plan

## Goal
Add a per-job max cost (USD) setting to the job detail page, mirroring the existing per-job max execution time feature. Per-job values override the repo policy; the built-in `max_cost_per_job_usd` default becomes $10, and this repo's `.foundry/policy.yaml` also moves to $10 (per the ticket author's answer).

## Changes
1. **Policy/shared logic**
   - `packages/shared/src/policy.ts`: default `max_cost_per_job_usd` 5 → 10; add `effectiveMaxCostUsd(override, policy)`.
   - `packages/shared/src/gate.ts`: accept an optional effective `maxCostUsd` in `GateInput`; cost rule uses it, falling back to policy.
   - `packages/shared/src/api.ts`: add `maxCostUsd` (nullable) to `ClaimedJobSchema` and to heartbeat `jobLimits` entries.
2. **Database**
   - `packages/db/src/schema.ts`: nullable `jobs.maxCostUsd` (`max_cost_usd` double precision).
   - `packages/db/migrations/0005_job_max_cost.sql` + `meta/_journal.json` entry.
3. **Control plane**
   - `packages/control/src/jobs.ts`: `setJobMaxCost` (positive finite number or null).
   - `packages/control/src/runners.ts`: include `maxCostUsd` in heartbeat `jobLimits`.
   - `packages/control/src/claim.ts`: pass `maxCostUsd` to claimed jobs.
   - `packages/control/src/merge-gate.ts`: evaluate the gate with `effectiveMaxCostUsd(job.maxCostUsd, policy)`.
4. **Runner**
   - `apps/runner/src/job-runner.ts`: effective `maxCostUsd` from the claim + policy; `setMaxCostUsd` for live heartbeat updates; enforce it in `consume`.
   - `apps/runner/src/daemon.ts`: apply `maxCostUsd` from `jobLimits`.
5. **Web UI**
   - `apps/web/src/app/actions.ts`: `maxCostAction`.
   - `apps/web/src/app/(panel)/jobs/[id]/page.tsx`: add a "Max cost (USD)" field to the Job limits card, showing the repo default when unset.
6. **Config/playbook**
   - `.foundry/policy.yaml`: `max_cost_per_job_usd: 10`.
   - `packages/playbooks/src/playbooks/onboarding.md`: sample policy 5 → 10.
7. **Tests**
   - `packages/shared/src/shared.test.ts`: default/override helper tests.
   - `packages/shared/src/gate.test.ts`: update over-budget fixture for $10 default; add per-job cap test.
   - `apps/runner/src/testing.ts`: fixture gains `maxCostUsd: null`.
   - `apps/runner/src/job-runner.test.ts`: update budget test for $10 default; add override test.
   - `packages/control/src/control.test.ts`: `setJobMaxCost` + heartbeat plumbing.

## Verify
`pnpm exec biome check --write <touched>`, targeted vitest runs (shared, runner, control), full `pnpm exec vitest run --maxWorkers=1`, `pnpm typecheck`, then UI screenshot evidence.

## Findings

- triage: Ticket is clear: add a per-job max cost setting to the job detail page (mirroring the existing per-job max execution time feature), default $10. Per author's answer, per-job overrides fall back to repo policy, the built-in policy default rises from $5 to $10, and this repo's .foundry/policy.yaml also changes to $10.
- investigating: Plan recorded: mirror the per-job max-execution-time feature for cost across shared schemas, DB migration, control plane, runner, and the job detail page; raise the built-in and repo policy defaults to $10; add tests.
- implementing: Implementation is complete across shared schemas/policy, DB migration 0005, control plane setter and heartbeat/claim/gate plumbing, runner enforcement, and the job detail page. Targeted tests and typechecks passed, run_checks passed (lint, typecheck, full tests), DB-backed control tests passed 13/13, and the UI was verified in a browser with a $10 default and a persisted custom value.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

- Q: The ticket says the per-job cost default should be $10, but the repo already has a cost cap: `max_cost_per_job_usd` is $5 both as the built-in default and explicitly in this repo's `.foundry/policy.yaml`. How should the new per-job setting and its $10 default relate to that policy?
  A: Same as the first option, and also change this repo's `.foundry/policy.yaml` max_cost_per_job_usd from 5 to 10 so jobs here default to $10.

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "ecc22153-602d-4490-9044-81c76f5a0367",
  "title": "Make each job cost configurable in job detail page",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "c80f6cf1-0554-46c3-b3e7-e350911d4036",
  "plan": "## Goal\nAdd a per-job max cost (USD) setting to the job detail page, mirroring the existing per-job max execution time feature. Per-job values override the repo policy; the built-in `max_cost_per_job_usd` default becomes $10, and this repo's `.foundry/policy.yaml` also moves to $10 (per the ticket author's answer).\n\n## Changes\n1. **Policy/shared logic**\n   - `packages/shared/src/policy.ts`: default `max_cost_per_job_usd` 5 → 10; add `effectiveMaxCostUsd(override, policy)`.\n   - `packages/shared/src/gate.ts`: accept an optional effective `maxCostUsd` in `GateInput`; cost rule uses it, falling back to policy.\n   - `packages/shared/src/api.ts`: add `maxCostUsd` (nullable) to `ClaimedJobSchema` and to heartbeat `jobLimits` entries.\n2. **Database**\n   - `packages/db/src/schema.ts`: nullable `jobs.maxCostUsd` (`max_cost_usd` double precision).\n   - `packages/db/migrations/0005_job_max_cost.sql` + `meta/_journal.json` entry.\n3. **Control plane**\n   - `packages/control/src/jobs.ts`: `setJobMaxCost` (positive finite number or null).\n   - `packages/control/src/runners.ts`: include `maxCostUsd` in heartbeat `jobLimits`.\n   - `packages/control/src/claim.ts`: pass `maxCostUsd` to claimed jobs.\n   - `packages/control/src/merge-gate.ts`: evaluate the gate with `effectiveMaxCostUsd(job.maxCostUsd, policy)`.\n4. **Runner**\n   - `apps/runner/src/job-runner.ts`: effective `maxCostUsd` from the claim + policy; `setMaxCostUsd` for live heartbeat updates; enforce it in `consume`.\n   - `apps/runner/src/daemon.ts`: apply `maxCostUsd` from `jobLimits`.\n5. **Web UI**\n   - `apps/web/src/app/actions.ts`: `maxCostAction`.\n   - `apps/web/src/app/(panel)/jobs/[id]/page.tsx`: add a \"Max cost (USD)\" field to the Job limits card, showing the repo default when unset.\n6. **Config/playbook**\n   - `.foundry/policy.yaml`: `max_cost_per_job_usd: 10`.\n   - `packages/playbooks/src/playbooks/onboarding.md`: sample policy 5 → 10.\n7. **Tests**\n   - `packages/shared/src/shared.test.ts`: default/override helper tests.\n   - `packages/shared/src/gate.test.ts`: update over-budget fixture for $10 default; add per-job cap test.\n   - `apps/runner/src/testing.ts`: fixture gains `maxCostUsd: null`.\n   - `apps/runner/src/job-runner.test.ts`: update budget test for $10 default; add override test.\n   - `packages/control/src/control.test.ts`: `setJobMaxCost` + heartbeat plumbing.\n\n## Verify\n`pnpm exec biome check --write <touched>`, targeted vitest runs (shared, runner, control), full `pnpm exec vitest run --maxWorkers=1`, `pnpm typecheck`, then UI screenshot evidence.",
  "findings": [
    "triage: Ticket is clear: add a per-job max cost setting to the job detail page (mirroring the existing per-job max execution time feature), default $10. Per author's answer, per-job overrides fall back to repo policy, the built-in policy default rises from $5 to $10, and this repo's .foundry/policy.yaml also changes to $10.",
    "investigating: Plan recorded: mirror the per-job max-execution-time feature for cost across shared schemas, DB migration, control plane, runner, and the job detail page; raise the built-in and repo policy defaults to $10; add tests.",
    "implementing: Implementation is complete across shared schemas/policy, DB migration 0005, control plane setter and heartbeat/claim/gate plumbing, runner enforcement, and the job detail page. Targeted tests and typechecks passed, run_checks passed (lint, typecheck, full tests), DB-backed control tests passed 13/13, and the UI was verified in a browser with a $10 default and a persisted custom value."
  ],
  "checks": [
    {
      "name": "lint",
      "status": "passed"
    },
    {
      "name": "typecheck",
      "status": "passed"
    },
    {
      "name": "test",
      "status": "passed"
    }
  ],
  "qa": [
    {
      "question": "The ticket says the per-job cost default should be $10, but the repo already has a cost cap: `max_cost_per_job_usd` is $5 both as the built-in default and explicitly in this repo's `.foundry/policy.yaml`. How should the new per-job setting and its $10 default relate to that policy?",
      "answer": "Same as the first option, and also change this repo's `.foundry/policy.yaml` max_cost_per_job_usd from 5 to 10 so jobs here default to $10."
    }
  ],
  "uncertainties": [],
  "updatedAt": "2026-11-08T01:43:44.102Z"
}
```
