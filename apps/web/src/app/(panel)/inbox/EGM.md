# web/src/app/(panel)/inbox

## Overview

The inbox collects everything that needs the signed-in user across five
sections: open questions, PRs handed to them for review, unassigned handovers,
jobs blocked for lack of capacity, and their own tickets in flight.

## Interface

- Default export `Inbox()` — async page calling `requireTeam()` and `inbox(ctx, team.id, user.id)` ([page.tsx:Inbox]).
- Local `JobRow` and `Section` presentational helpers ([page.tsx:JobRow], [page.tsx:Section]).

## Invariants

- Section counts come directly from the `inbox` control result; a zero count renders the section's empty message ([page.tsx:Section]).
- Every row links to `/jobs/<id>` and shows a `StatusPill` plus recency ([page.tsx:JobRow]).
- Questions show the question prompt as the row note; reviews show the PR URL; blocked rows show the blocking reason ([page.tsx:Inbox]).

## Side Effects

- Reads the DB through `inbox`; no writes.
- Re-renders on realtime `jobs` and `questions` changes (`tablesForPage("/inbox")`).

## Verification

- Run: `pnpm test`
