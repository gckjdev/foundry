# web/src/app/(panel)/team

## Overview

Team roster page: active members with roles and notification preference, pending
invites, and (for admins) an invite-by-GitHub-login form.

## Interface

- Default export `Team()` — calls `requireTeam()`, `teamMembers(ctx, team.id)`, and a direct select of `invites` for the team ([page.tsx:Team]).
- Admin form submits to `inviteAction` ([page.tsx:Team], [actions.ts:inviteAction]).

## Invariants

- The invite form renders only for admins ([page.tsx:Team]).
- Invited users appear as rows with the "invited" pill; their copy says they join on first sign-in ([page.tsx:Team]).
- Invite role is either `member` or `admin`; anything else is coerced to `member` ([actions.ts:inviteAction]).
- Members show the stored `notifyPref`; no writes happen on render.

## Side Effects

- Read-only member/invite queries.
- `inviteAction` inserts an invite and revalidates `/team` ([actions.ts:inviteAction]).

## Verification

- Run: `pnpm test`
