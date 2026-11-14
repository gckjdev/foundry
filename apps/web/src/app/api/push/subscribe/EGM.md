# web/src/app/api/push/subscribe

## Overview

Web Push subscription endpoint used by the settings page's push toggle.

## Interface

- `GET()` — returns `{ publicKey: process.env.VAPID_PUBLIC_KEY ?? null }` ([route.ts:GET]).
- `POST(req)` — requires the current team, stores the JSON subscription on the user row, and sets `notifyPref: "push"` ([route.ts:POST]).

## Invariants

- The public key is null when `VAPID_PUBLIC_KEY` is unset; the client then reports that push is not configured ([route.ts:GET]).
- Saving a subscription always switches the user's notification preference to `push` ([route.ts:POST]).
- Both methods are authenticated via `requireTeam` ([route.ts]).

## Side Effects

- Updates the `users` row (`pushSubscription`, `notifyPref`) ([route.ts:POST]).

## Verification

- Run: `pnpm test`
