# web/src/app/api/auth/[...nextauth]

## Overview

Exposes the Auth.js GitHub provider endpoints (sign-in, callback, session).

## Interface

- `GET`, `POST` — re-exported from the NextAuth `handlers` ([route.ts:handlers]); `runtime = "nodejs"` ([route.ts:runtime]).

## Invariants

- Must run on the Node.js runtime because the JWT callback uses the DB and control plane ([route.ts:runtime], [../../../auth.ts]).
- All auth semantics (providers, JWT session, `/signin` pages) come from `src/auth.ts`; this file adds no logic ([route.ts]).

## Side Effects

- OAuth redirects, GitHub token exchange, DB user upsert, and session cookies ([../../../auth.ts]).

## Verification

- Run: `pnpm test`
