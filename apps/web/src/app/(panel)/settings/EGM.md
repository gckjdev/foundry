# web/src/app/(panel)/settings

## Overview

User and team settings: notification preference, contact email, browser push
registration, and admin-editable team name, daily spend cap, default
harness/model, and outgoing webhook URL.

## Interface

- Default export `Settings()` — calls `requireTeam()`, loads the user row, and computes `spendToday(ctx, team.id)` ([page.tsx:Settings]).
- Client `PushToggle()` — fetches `/api/push/subscribe` for the VAPID public key, requests permission, registers `/sw.js`, subscribes, and POSTs the subscription ([push-toggle.tsx:PushToggle]).
- Forms submit to `notifyPrefAction` and `teamSettingsAction` ([page.tsx:Settings], [actions.ts]).

## Invariants

- Notification preference is one of `github`, `email`, `push`, `digest`; invalid values are ignored by the action ([actions.ts:notifyPrefAction]).
- Team settings are inside a fieldset disabled for non-admins ([page.tsx:Settings]).
- The daily spend cap accepts only finite positive numbers; empty/non-positive clears it to null ([actions.ts:teamSettingsAction]).
- The default harness falls back to `claude-code` when blank ([actions.ts:teamSettingsAction]).
- Push enabling reports a specific message when push is unsupported or the server has no VAPID key ([push-toggle.tsx:PushToggle]).

## Side Effects

- Writes user notification settings, email, and optional push subscription ([actions.ts], [push/subscribe/route.ts]).
- Writes team name, spend cap, default harness/model, and outgoing webhook ([actions.ts:teamSettingsAction]).
- Registers a service worker and creates a browser push subscription ([push-toggle.tsx:PushToggle]).

## Verification

- Run: `pnpm test`
