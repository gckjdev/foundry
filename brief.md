# Handoff brief: Show hours with no online runner on the runners capacity card

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T02:21:55.104Z

## Plan

1. `packages/control/src/metrics.ts` — add `CapacityCard` interface and `capacityCard(ctx, teamId, days = 7)`. Compute the merged union of intervals during which at least one job sat in `queued`, derived from `events` (`stage_changed` → `queued` until the next `stage_changed` with `from = 'queued'`, or `now`). Clip to the window, merge overlaps, sum to hours. Return `hoursNoOnlineRunner`, `hoursQueueWithNoRunner` (same value; document why online history is not reconstructable from `runners.last_seen_at`), and `estimatedHoursSavedBySharedRunner` (same value).
2. `apps/web/src/app/(panel)/runners/page.tsx` — when `shared.length === 0 && list.length > 0`, call `capacityCard` and replace the static laptops-only notice with a card showing the two hour figures plus one sentence that a shared runner would cover those hours. Keep the four stat cards and hide the card when a shared runner exists.
3. `packages/control/src/control.test.ts` — add a test seeding a queued job (with a `stage_changed` → `queued` event 6h before the test clock) and no runners; expect a positive ~6h count. Add overlapping/claimed intervals to prove the union does not double-count.
4. Verify with Biome on touched files, `FOUNDRY_TEST_DATABASE_URL=… pnpm exec vitest run packages/control/src/control.test.ts`, `pnpm typecheck` (web split out), then `run_checks`. Screenshot `/runners` on the dev server if the fixture can render.

## Findings

- triage: Ticket is clear: add capacityCard() to packages/control/src/metrics.ts returning hours with a queued job and no online runner plus a simple saved-hours estimate, and render it on /runners for laptops-only teams. Investigated metrics.ts, the runners page, the jobs/events schema, heartbeat/isOnline helpers, and the existing test infrastructure.
- investigating: Plan recorded. Queued intervals will come from `stage_changed` events (exact, handles requeues); online history is not persisted so both hour fields share the documented queued-hours formula, as the ticket permits. UI change is confined to the laptops-only branch of /runners, with a DB-backed test in control.test.ts.
- implementing: Added capacityCard() with a documented queued-hours union formula, rendered it in the laptops-only branch of /runners, and added a DB-backed control test covering a 6h no-runner queue plus overlap dedup. Targeted vitest (15/15) and control/web typechecks pass; a screenshot of the rendered card was captured.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "dc36f799-3f8c-4546-a6d7-bc85233c6bcf",
  "title": "Show hours with no online runner on the runners capacity card",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "cd63a697-2d17-4943-b235-421cc96d47be",
  "plan": "1. `packages/control/src/metrics.ts` — add `CapacityCard` interface and `capacityCard(ctx, teamId, days = 7)`. Compute the merged union of intervals during which at least one job sat in `queued`, derived from `events` (`stage_changed` → `queued` until the next `stage_changed` with `from = 'queued'`, or `now`). Clip to the window, merge overlaps, sum to hours. Return `hoursNoOnlineRunner`, `hoursQueueWithNoRunner` (same value; document why online history is not reconstructable from `runners.last_seen_at`), and `estimatedHoursSavedBySharedRunner` (same value).\n2. `apps/web/src/app/(panel)/runners/page.tsx` — when `shared.length === 0 && list.length > 0`, call `capacityCard` and replace the static laptops-only notice with a card showing the two hour figures plus one sentence that a shared runner would cover those hours. Keep the four stat cards and hide the card when a shared runner exists.\n3. `packages/control/src/control.test.ts` — add a test seeding a queued job (with a `stage_changed` → `queued` event 6h before the test clock) and no runners; expect a positive ~6h count. Add overlapping/claimed intervals to prove the union does not double-count.\n4. Verify with Biome on touched files, `FOUNDRY_TEST_DATABASE_URL=… pnpm exec vitest run packages/control/src/control.test.ts`, `pnpm typecheck` (web split out), then `run_checks`. Screenshot `/runners` on the dev server if the fixture can render.",
  "findings": [
    "triage: Ticket is clear: add capacityCard() to packages/control/src/metrics.ts returning hours with a queued job and no online runner plus a simple saved-hours estimate, and render it on /runners for laptops-only teams. Investigated metrics.ts, the runners page, the jobs/events schema, heartbeat/isOnline helpers, and the existing test infrastructure.",
    "investigating: Plan recorded. Queued intervals will come from `stage_changed` events (exact, handles requeues); online history is not persisted so both hour fields share the documented queued-hours formula, as the ticket permits. UI change is confined to the laptops-only branch of /runners, with a DB-backed test in control.test.ts.",
    "implementing: Added capacityCard() with a documented queued-hours union formula, rendered it in the laptops-only branch of /runners, and added a DB-backed control test covering a 6h no-runner queue plus overlap dedup. Targeted vitest (15/15) and control/web typechecks pass; a screenshot of the rendered card was captured."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T02:21:55.104Z"
}
```
