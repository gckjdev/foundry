# Handoff brief: Fix bug: UI page keeps freshing

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T03:01:57.757Z

## Plan

1. Add `apps/web/src/components/realtime-tables.ts`: map each panel route to the tables it renders (`/board` → `jobs` only) plus an `isRefreshMessage` guard that fails closed on unknown/missing tables.
2. Update `apps/web/src/components/live-refresh.tsx` to filter realtime messages by that per-page table set, keeping the WebSocket open across client navigation and keeping the optional `tables` prop as an override.
3. Add `apps/web/src/components/realtime-tables.test.ts` (unit) proving the board ignores `events`/`runners` changes, still refreshes on `jobs`, the job page still follows `events`, and pages without live data ignore everything.
4. Verify with biome on touched files, `pnpm --filter @foundry/web typecheck`, the new Vitest file, then `run_checks`; record a note that the panel needs GitHub sign-in for a live browser check.

## Findings

- triage: The panel layout mounts LiveRefresh without a table filter, so every Postgres NOTIFY for the team calls router.refresh(). The board therefore re-renders on rows it never displays: one `events` row per agent tool call (flushed every second) and a `runners` row per 15s heartbeat. That is the continuous refreshing on /board. Fix will scope each panel page to the tables it actually renders.
- investigating: Scoping realtime refreshes per panel page: board watches jobs only, job detail keeps events, other pages watch only tables they render.
- implementing: Per-page realtime table filtering is implemented; new unit test passes, biome clean, web typecheck passes. Running the repo recipe checks now.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "3ddf935d-a9d4-4919-b980-3e7810589b09",
  "title": "Fix bug: UI page keeps freshing",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "c8ee81cf-9d0f-4654-91ce-ac8ae3b53b5e",
  "plan": "1. Add `apps/web/src/components/realtime-tables.ts`: map each panel route to the tables it renders (`/board` → `jobs` only) plus an `isRefreshMessage` guard that fails closed on unknown/missing tables.\n2. Update `apps/web/src/components/live-refresh.tsx` to filter realtime messages by that per-page table set, keeping the WebSocket open across client navigation and keeping the optional `tables` prop as an override.\n3. Add `apps/web/src/components/realtime-tables.test.ts` (unit) proving the board ignores `events`/`runners` changes, still refreshes on `jobs`, the job page still follows `events`, and pages without live data ignore everything.\n4. Verify with biome on touched files, `pnpm --filter @foundry/web typecheck`, the new Vitest file, then `run_checks`; record a note that the panel needs GitHub sign-in for a live browser check.",
  "findings": [
    "triage: The panel layout mounts LiveRefresh without a table filter, so every Postgres NOTIFY for the team calls router.refresh(). The board therefore re-renders on rows it never displays: one `events` row per agent tool call (flushed every second) and a `runners` row per 15s heartbeat. That is the continuous refreshing on /board. Fix will scope each panel page to the tables it actually renders.",
    "investigating: Scoping realtime refreshes per panel page: board watches jobs only, job detail keeps events, other pages watch only tables they render.",
    "implementing: Per-page realtime table filtering is implemented; new unit test passes, biome clean, web typecheck passes. Running the repo recipe checks now."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T03:01:57.757Z"
}
```
