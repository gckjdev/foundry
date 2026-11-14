# web/public

## Overview

Static files served at the site root. The only code-bearing file is `sw.js`, the
service worker that renders Web Push notifications and handles clicks.

## Interface

- `push` event listener — parses the notification JSON payload (`title`, `body`, `url`) and calls `self.registration.showNotification` ([sw.js:push]).
- `notificationclick` event listener — closes the notification and opens the stored `url` in a client window ([sw.js:notificationclick]).

## Invariants

- A missing or unparsable push payload falls back to `{title:"Foundry", body:""}` ([sw.js:push]).
- The notification `tag` is the payload `url`, so a newer notification for the same job replaces the older one ([sw.js:push]).
- Click navigation only happens when `data.url` is present ([sw.js:notificationclick]).

## Side Effects

- Displays OS/browser notifications and opens browser windows/tabs.

## Verification

- Run: `pnpm test`
