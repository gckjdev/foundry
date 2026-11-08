# Handoff brief: Performance optimization

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T05:44:33.975Z

## Plan

## Findings (board / inbox / runners page load)

1. **Board and Inbox call GitHub on every render.** `boardJobs()` and `inbox()` both `await reconcileLabeledIssues(ctx)`, which loops over every onboarded repo and does a sequential `gh.listIssues` HTTP call. That runs on every page load *and* on every realtime `router.refresh()`. The webhook (`issues.labeled`) and the in-process worker (every `SWEEP_INTERVAL_MS = 30s`) already own this catch-up, so the read path is paying GitHub latency for nothing.
2. **Extra sequential DB round trips.** Board runs `diagnoseQueue` after the row query; Inbox awaits the user row before its three queries and then `diagnoseQueue`; Runners awaits `teamRunners` → running/readiness → `capacityCard`. These can be overlapped.
3. **Over-fetching job rows.** Board selects all `jobs` columns (including `body`, `plan`, `confidence`, `gate_result`) for up to 300 rows; Inbox does the same. Only a handful of columns are rendered.
4. **Duplicate session work.** `requireTeam()` runs in both `(panel)/layout.tsx` and every page (auth + `teamsForUser` membership query) with no per-request cache.
5. **No index for the board/inbox ordering.** Board and inbox order by `updated_at` filtered on `team_id`; indexes only cover `(team_id, status)` / `(runner_id)`.

## Plan

1. `packages/control/src/queries.ts`
   - Remove `reconcileLabeledIssues` from `boardJobs`/`inbox` (keep the function + worker + webhook catch-up); document why.
   - Select only the columns the board renders (`BoardJobRow` Pick type), same for inbox (`InboxJob` Pick type).
   - Run the board row query and `diagnoseQueue` concurrently; run the inbox user lookup alongside handover/mine queries and parallelise questions + diagnosis.
2. `apps/web/src/server/session.ts` — wrap `requireUser` / `requireTeam` in React `cache()` so layout + page + actions share one lookup per request.
3. `apps/web/src/app/(panel)/runners/page.tsx` — fetch `capacityCard` in the same `Promise.all` as running jobs/readiness instead of a third round trip; adjust the inbox page's `Job` import to `InboxJob`.
4. `packages/db/migrations/0008_jobs_team_updated_idx.sql` — add `jobs(team_id, updated_at)` index for board/inbox ordering.
5. Tests: `packages/control/src/surfaces.test.ts` — assert `boardJobs`/`inbox` perform no `gh.listIssues` calls (fails before the change), keep existing board/inbox behaviour assertions green.
6. Verify: `pnpm exec biome check --write` on touched files, targeted `vitest run` with `FOUNDRY_TEST_DATABASE_URL`, package + web typecheck, then full recipe checks.

## Findings

- triage: Ticket is clear enough: optimize loading latency for the board, inbox, and runner panel pages, looking at both frontend and backend. Investigating the current data-fetching and rendering paths for those three pages.
- investigating: Plan recorded. Implementing: remove synchronous GitHub catch-up from board/inbox reads, overlap DB round trips, narrow selected job columns, cache per-request session lookups, add a jobs(team_id, updated_at) index, and add a regression test that board/inbox make no GitHub list calls.
- implementing: Implementation complete: board/inbox read paths no longer call GitHub reconcile, job columns are narrowed, board/inbox/runners queries overlap, session lookups are cached per request, and a jobs(team_id, updated_at) index plus regression test were added. Targeted control tests (26) and control+web typechecks pass; running the full recipe checks now.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "76a8017a-463f-4ba7-a1bf-630985f431bf",
  "title": "Performance optimization",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "764d93fb-868b-4fee-b8b7-59b3e30e85da",
  "plan": "## Findings (board / inbox / runners page load)\n\n1. **Board and Inbox call GitHub on every render.** `boardJobs()` and `inbox()` both `await reconcileLabeledIssues(ctx)`, which loops over every onboarded repo and does a sequential `gh.listIssues` HTTP call. That runs on every page load *and* on every realtime `router.refresh()`. The webhook (`issues.labeled`) and the in-process worker (every `SWEEP_INTERVAL_MS = 30s`) already own this catch-up, so the read path is paying GitHub latency for nothing.\n2. **Extra sequential DB round trips.** Board runs `diagnoseQueue` after the row query; Inbox awaits the user row before its three queries and then `diagnoseQueue`; Runners awaits `teamRunners` → running/readiness → `capacityCard`. These can be overlapped.\n3. **Over-fetching job rows.** Board selects all `jobs` columns (including `body`, `plan`, `confidence`, `gate_result`) for up to 300 rows; Inbox does the same. Only a handful of columns are rendered.\n4. **Duplicate session work.** `requireTeam()` runs in both `(panel)/layout.tsx` and every page (auth + `teamsForUser` membership query) with no per-request cache.\n5. **No index for the board/inbox ordering.** Board and inbox order by `updated_at` filtered on `team_id`; indexes only cover `(team_id, status)` / `(runner_id)`.\n\n## Plan\n\n1. `packages/control/src/queries.ts`\n   - Remove `reconcileLabeledIssues` from `boardJobs`/`inbox` (keep the function + worker + webhook catch-up); document why.\n   - Select only the columns the board renders (`BoardJobRow` Pick type), same for inbox (`InboxJob` Pick type).\n   - Run the board row query and `diagnoseQueue` concurrently; run the inbox user lookup alongside handover/mine queries and parallelise questions + diagnosis.\n2. `apps/web/src/server/session.ts` — wrap `requireUser` / `requireTeam` in React `cache()` so layout + page + actions share one lookup per request.\n3. `apps/web/src/app/(panel)/runners/page.tsx` — fetch `capacityCard` in the same `Promise.all` as running jobs/readiness instead of a third round trip; adjust the inbox page's `Job` import to `InboxJob`.\n4. `packages/db/migrations/0008_jobs_team_updated_idx.sql` — add `jobs(team_id, updated_at)` index for board/inbox ordering.\n5. Tests: `packages/control/src/surfaces.test.ts` — assert `boardJobs`/`inbox` perform no `gh.listIssues` calls (fails before the change), keep existing board/inbox behaviour assertions green.\n6. Verify: `pnpm exec biome check --write` on touched files, targeted `vitest run` with `FOUNDRY_TEST_DATABASE_URL`, package + web typecheck, then full recipe checks.",
  "findings": [
    "triage: Ticket is clear enough: optimize loading latency for the board, inbox, and runner panel pages, looking at both frontend and backend. Investigating the current data-fetching and rendering paths for those three pages.",
    "investigating: Plan recorded. Implementing: remove synchronous GitHub catch-up from board/inbox reads, overlap DB round trips, narrow selected job columns, cache per-request session lookups, add a jobs(team_id, updated_at) index, and add a regression test that board/inbox make no GitHub list calls.",
    "implementing: Implementation complete: board/inbox read paths no longer call GitHub reconcile, job columns are narrowed, board/inbox/runners queries overlap, session lookups are cached per request, and a jobs(team_id, updated_at) index plus regression test were added. Targeted control tests (26) and control+web typechecks pass; running the full recipe checks now."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T05:44:33.975Z"
}
```
