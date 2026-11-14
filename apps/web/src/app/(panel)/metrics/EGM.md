# web/src/app/(panel)/metrics

## Overview

Team metrics dashboard over a 7/28/90-day window, optionally filtered to one
repo. It renders the product spec's headline rates, cost and latency medians,
OS/harness breakdowns, and per-runner utilization.

## Interface

- Default export `Metrics({ searchParams })` — calls `requireTeam()`, `teamRepos`, and `teamMetrics(ctx, { teamId, days, repoId })` ([page.tsx:Metrics]).
- Local `Stat` and `BreakdownTable` presentational helpers ([page.tsx:Stat], [page.tsx:BreakdownTable]).

## Invariants

- `days` is restricted to 7, 28, or 90; anything else falls back to 28 ([page.tsx:Metrics]).
- `repo` is applied only when it is one of the team's repos, otherwise the view is all repos ([page.tsx:Metrics]).
- Utilization bars are clamped to the computed `utilization` (rendered as a width percentage) ([page.tsx:Metrics]).
- Empty breakdown/ utilization lists render an explicit "no data" message rather than blank cards ([page.tsx:Metrics]).

## Side Effects

- Read-only DB queries through `teamMetrics` and `teamRepos`.
- Re-renders on realtime `jobs` changes (`tablesForPage("/metrics")`).

## Verification

- Run: `pnpm test`
