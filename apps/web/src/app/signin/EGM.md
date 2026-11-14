# web/src/app/signin

## Overview

GitHub sign-in page and human-readable OAuth error copy.

## Interface

- Default export `SignIn({ searchParams })` — reads `error` and renders a mapped message ([page.tsx:SignIn]).
- Submits to `signInAction` ([page.tsx:SignIn], [../actions.ts:signInAction]).
- `ERRORS` maps `Configuration`, `OAuthCallback`, `AccessDenied`, and `Default` to copy ([page.tsx:ERRORS]).

## Invariants

- An unknown error code falls back to the `Default` message ([page.tsx:SignIn]).
- The `Configuration` copy specifically explains the GitHub token-exchange timeout and suggests retrying ([page.tsx:ERRORS]).
- Signing in redirects to `/api/github/setup` so a pre-existing installation is linked ([../actions.ts:signInAction]).

## Side Effects

- Starts the Auth.js GitHub OAuth flow ([../actions.ts:signInAction]).

## Verification

- Run: `pnpm test`
