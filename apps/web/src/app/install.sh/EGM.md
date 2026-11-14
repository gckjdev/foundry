# web/src/app/install.sh

## Overview

Serves the runner installer script at `GET /install.sh`, used as
`curl -fsSL <server>/install.sh | sh -s -- <fdj_token>`.

## Interface

- `GET()` — returns `installScript({ serverUrl, releaseUrl })` as `text/x-shellscript` ([route.ts:GET]).
- `dynamic = "force-dynamic"` ([route.ts:dynamic]).

## Invariants

- The script embeds `FOUNDRY_PUBLIC_URL` (default `http://localhost:3000`) and `FOUNDRY_RELEASE_URL` so the downloaded runner joins this server ([route.ts:GET]).
- The response is `no-store` so a changed URL is not cached ([route.ts:GET]).
- The route has no authentication; it emits no secrets, only public URLs ([route.ts:GET]).

## Side Effects

- None beyond reading environment variables and returning a response body.

## Verification

- Run: `pnpm test`
