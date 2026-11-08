# Handoff brief: Show recipe PR and per-runner readiness on the repos page

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T04:51:30.409Z

## Plan

1. `packages/control/src/queries.ts`: add `teamReposWithReadiness(ctx, teamId)` returning each repo plus `recipePrUrl` (latest `jobs.kind = 'onboarding'` row with a non-null `prUrl`, newest first) and `readiness` (rows from `runner_repo_readiness` joined to non-removed runners, ordered by runner name).
2. `packages/control/src/control.test.ts`: add a test seeding one repo, one ready runner, one not-ready runner with a reason, and an onboarding job with `prUrl`; assert both readiness entries and the PR URL come back.
3. `apps/web/src/app/(panel)/repos/page.tsx`: switch to the new helper and render "Recipe PR ↗" plus a per-runner readiness line under each existing repo card. Keep admin forms untouched.
4. Verify: biome on touched files, targeted vitest (`control.test.ts`), typecheck; run the panel and screenshot `/repos` showing a readiness line.

## Findings

- triage: Ticket is clear: extend the existing /repos cards with a recipe PR link and per-runner readiness, backed by a new control helper and test. No product ambiguity worth asking about (the ticket explicitly allows omitting "not checked" runners).
- investigating: Found the three touch points: `teamRepos` in queries.ts (where the helper belongs), `control.test.ts` + `seedRunner` test helpers, and the existing repo card in the panel. Readiness data already exists in `runner_repo_readiness`; onboarding PRs are on `jobs.prUrl` for `kind = 'onboarding'`.
- implementing: Implemented the helper + panel rendering and added the control test. Targeted vitest (18 tests), control/web typechecks and biome all pass; the panel was started on 41010 against a throwaway seeded DB and /repos shows the Recipe PR link plus ready/not-ready runner lines.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "47a67246-3976-41e9-8d5e-3c651f731c4a",
  "title": "Show recipe PR and per-runner readiness on the repos page",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "07248a86-1c3e-4b29-b7f7-c1cf028c6c48",
  "plan": "1. `packages/control/src/queries.ts`: add `teamReposWithReadiness(ctx, teamId)` returning each repo plus `recipePrUrl` (latest `jobs.kind = 'onboarding'` row with a non-null `prUrl`, newest first) and `readiness` (rows from `runner_repo_readiness` joined to non-removed runners, ordered by runner name).\n2. `packages/control/src/control.test.ts`: add a test seeding one repo, one ready runner, one not-ready runner with a reason, and an onboarding job with `prUrl`; assert both readiness entries and the PR URL come back.\n3. `apps/web/src/app/(panel)/repos/page.tsx`: switch to the new helper and render \"Recipe PR ↗\" plus a per-runner readiness line under each existing repo card. Keep admin forms untouched.\n4. Verify: biome on touched files, targeted vitest (`control.test.ts`), typecheck; run the panel and screenshot `/repos` showing a readiness line.",
  "findings": [
    "triage: Ticket is clear: extend the existing /repos cards with a recipe PR link and per-runner readiness, backed by a new control helper and test. No product ambiguity worth asking about (the ticket explicitly allows omitting \"not checked\" runners).",
    "investigating: Found the three touch points: `teamRepos` in queries.ts (where the helper belongs), `control.test.ts` + `seedRunner` test helpers, and the existing repo card in the panel. Readiness data already exists in `runner_repo_readiness`; onboarding PRs are on `jobs.prUrl` for `kind = 'onboarding'`.",
    "implementing: Implemented the helper + panel rendering and added the control test. Targeted vitest (18 tests), control/web typechecks and biome all pass; the panel was started on 41010 against a throwaway seeded DB and /repos shows the Recipe PR link plus ready/not-ready runner lines."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T04:51:30.409Z"
}
```
