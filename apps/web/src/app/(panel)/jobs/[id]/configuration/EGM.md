# web/src/app/(panel)/jobs/[id]/configuration

## Overview

Per-job configuration page for execution-time and cost limits. It shows the
job's own override or the repo policy default and saves both limits together.

## Interface

- Default export `JobConfigurationPage({ params })` — loads `jobDetail` and `repoPolicy`, returns `notFound()` when the job is missing ([page.tsx:JobConfigurationPage]).
- `jobLimitValues(job, policy)` — returns `{ maxJobMinutes, maxCostUsd, limitsKey }`, falling back to `policy.max_job_minutes` / `policy.max_cost_per_job_usd` ([limits.ts:jobLimitValues]).
- Submits to `jobLimitsAction` from `../../../../actions` ([page.tsx:JobConfigurationPage]).

## Invariants

- The form is keyed by `limitsKey`, which changes only when a persisted override changes, so it remounts with freshly saved values instead of stale uncontrolled inputs ([limits.ts:jobLimitValues]).
- A null job override displays the policy value and the copy "Using the repo default"; otherwise "Custom for this job" ([page.tsx:JobConfigurationPage]).
- The copy states that limit changes apply to a running job ([page.tsx:JobConfigurationPage]).
- Invalid input is rejected by the action without persisting either field ([actions.ts:jobLimitsAction]).

## Side Effects

- Reads the job and repo policy; the form action writes `maxJobMinutes`/`maxCostUsd` and revalidates the job and configuration paths ([actions.ts:jobLimitsAction]).

## Verification

- Run: `pnpm test`
