# web/src/app/setup

## Overview

First-run page for a signed-in user who has no team yet. It offers team
creation and explains the invite alternative.

## Interface

- Default export `Setup()` — requires a user (redirects to `/signin` otherwise) and submits to `createTeamAction` ([page.tsx:Setup]).

## Invariants

- Rendering requires only an authenticated user, not a team; this is the redirect target when `requireTeam` finds zero teams ([../server/session.ts:requireTeam]).
- The team name is required ([page.tsx:Setup]).
- `createTeamAction` sets the team cookie, optionally links a pending install, syncs unlinked installations, and redirects to `/repos` ([../actions.ts:createTeamAction]).

## Side Effects

- Form submission creates a team and sets `foundry_team`; may link a GitHub installation and sync repos ([../actions.ts:createTeamAction]).

## Verification

- Run: `pnpm test`
