# web/src/app/api/github/setup

## Overview

GitHub App Setup URL and post-login landing. It attaches a GitHub App
installation to the signed-in user's team, stashing the installation id in a
cookie when the user is not signed in yet.

## Interface

- `GET(req)` — resolves `installation_id` from the query (preferred) or the `foundry_install` cookie, then redirects ([route.ts:GET]).

## Invariants

- Missing installation id: signed-in admins trigger `syncUnlinkedInstallations` and land on `/repos?installed=1`; anonymous users go to `/signin` ([route.ts:GET]).
- With an installation but no session, the id is stored in an httpOnly, same-site, 30-minute `foundry_install` cookie and the user is sent to `/signin` ([route.ts:GET]).
- A signed-in user must be a team admin (`requireAdmin`) to link the installation; success deletes the install cookie and redirects to `/repos?installed=1` ([route.ts:GET]).
- Only positive integer installation ids are accepted ([route.ts:GET]).

## Side Effects

- Writes the install cookie and calls `linkInstallation`/`syncUnlinkedInstallations`, which write to the DB and may call GitHub ([route.ts:GET]).

## Verification

- Run: `pnpm test`
