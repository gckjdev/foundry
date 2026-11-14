# web/src/app/api/jobs/[id]/events

## Overview

Incremental timeline feed for the job page's live log. The client polls it with
a cursor and appends the returned rows.

## Interface

- `GET(req, { params })` — requires the current team, parses `after` (default 0), and returns `{ events: eventsSince(ctx, team.id, id, after) }` ([route.ts:GET]).

## Invariants

- Access is team-scoped through `requireTeam`; `eventsSince` is called with the team id so one team cannot read another's job events ([route.ts:GET]).
- A non-finite `after` is coerced to 0 ([route.ts:GET]).
- The endpoint is read-only and returns JSON through the shared `json` helper ([route.ts:GET]).

## Side Effects

- Reads the job timeline from the DB.

## Verification

- Run: `pnpm test`
