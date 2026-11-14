# web/src/app/api/artifacts/[id]

## Overview

Serves one stored artifact (screenshot, log, evidence file) when the signed
`t` token is valid.

## Interface

- `GET(req, { params })` — reads the `t` query token, calls `readArtifact(ctx, id, token)`, and returns the bytes or 404 ([route.ts:GET]).

## Invariants

- The artifact id is not enough: access requires the signed token (`readArtifact` returns null for a bad token) ([route.ts:GET]).
- The response echoes the row's `contentType` and name and is cached `private, max-age=86400` ([route.ts:GET]).
- A missing artifact or invalid token is a plain `404 not found` ([route.ts:GET]).

## Side Effects

- Fetches bytes from the artifact store via `@foundry/control` ([route.ts:GET]).

## Verification

- Run: `pnpm test`
