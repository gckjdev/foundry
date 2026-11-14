# web/src/app/(panel)/board

## Overview

The board page renders every team job as a ticket in one of eight status lanes,
with running count and per-ticket execution time and cost.

## Interface

- `LANES` — lane definitions mapping titles to `JobStatus[]`: Queued, Working (`triage`…`verifying`), Needs input, PR / CI, PR review, Waiting on you, Done (`merged`), Stopped (`failed`, `cancelled`) ([page.tsx:LANES]).
- Default export `Board()` — async page calling `requireTeam()` and `boardJobs(ctx, team.id)` ([page.tsx:Board]).

## Invariants

- A ticket appears in exactly one lane, chosen by its current status; unknown statuses are not rendered ([page.tsx:Board]).
- The header counts only `RUNNING_STATUSES` as running and `queued` as queued ([page.tsx:Board]).
- "Working" and "PR review" lanes are marked hot only when non-empty ([page.tsx:LANES]).
- Each ticket links to `/jobs/<id>` and displays repo name, issue number, `jobElapsed`, cost, status/runner, and recency ([page.tsx:Board]).
- Empty board shows onboarding guidance rather than an empty grid ([page.tsx:Board]).

## Side Effects

- Reads jobs from the DB via `boardJobs`; no writes.
- Re-renders on realtime `jobs` changes through the panel live pill (`tablesForPage("/board")` = `["jobs"]`).

## Verification

- Run: `pnpm test`
