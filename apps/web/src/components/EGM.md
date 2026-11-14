# web/src/components

## Overview

Shared UI helpers for the panel: duration formatting, a debounced realtime
refresh subscription, a client shell that survives server refreshes, the
page→table mapping used by that subscription, and status/formatting primitives.

## Interface

- `duration.ts` — `elapsed(start, end)` and `jobElapsed(job)` ([duration.ts]).
- `live-refresh.tsx` — client `LiveRefresh({ tables? })`; connects to the realtime service using `/api/realtime-token`, filters messages with `isRefreshMessage`, debounces `router.refresh()` by 400 ms, reconnects with exponential backoff (max 30 s), and renders a live/connecting/offline pill ([live-refresh.tsx:LiveRefresh]).
- `panel-shell.tsx` — client `PanelShell({ nav, children })` owning `.shell` and `<main key={pathname}>` ([panel-shell.tsx:PanelShell]).
- `realtime-tables.ts` — `tablesForPage(pathname)` and `isRefreshMessage(tables, msg)` plus the internal `PAGE_TABLES`/`NOISE_COLUMNS` maps ([realtime-tables.ts]).
- `status.tsx` — `StatusPill`, `ago`, `usd`, `pct` ([status.tsx]).

## Invariants

- `elapsed` clamps negative durations to 0 and formats `s`/`m`/`h m`/`d h` ([duration.ts:elapsed]).
- `jobElapsed` trusts `finishedAt` only once the job stopped (`failed` or terminal); a retried job keeps counting from its first claim ([duration.ts:jobElapsed]).
- Page→table mapping: `/board`→jobs; `/inbox`→jobs,questions; `/jobs/`→jobs,questions; `/runners`→runners,jobs; `/repos`→jobs; `/metrics`→jobs; no others ([realtime-tables.ts:PAGE_TABLES]).
- `isRefreshMessage` ignores non-`change` messages, unwatched tables, and UPDATEs whose differing columns are all noise (`jobs.cost_usd/tokens_in/tokens_out/updated_at`, `questions.gh_comment_id`, runner telemetry); INSERT/DELETE always refresh, and an empty column list refreshes defensively ([realtime-tables.ts:isRefreshMessage]).
- The realtime WebSocket is opened once for the shell's lifetime; navigation only changes the watched set ([live-refresh.tsx:LiveRefresh]).
- `StatusPill` maps statuses to tones and falls back to the raw status when unknown ([status.tsx:StatusPill]).

## Side Effects

- Opens a WebSocket to the realtime service and fetches a token from the API ([live-refresh.tsx:LiveRefresh]).
- Calls `router.refresh()` (server re-render) after debounced change messages.

## Verification

- Run: `pnpm test`
