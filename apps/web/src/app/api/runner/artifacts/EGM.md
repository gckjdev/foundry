# web/src/app/api/runner/artifacts

## Overview

Raw artifact upload from a runner (screenshots, logs, evidence).

## Interface

- `POST(req)` — authenticates the runner, resolves the job from the `x-foundry-job` header via `ownedJob`, reads the raw body, and returns `{ artifactId, url }` ([route.ts:POST]).

## Invariants

- The upload is rejected with 413 when the body exceeds 10 MB (`MAX_BYTES = 10 * 1024 * 1024`) ([route.ts:MAX_BYTES]).
- The job must be owned by the calling runner ([route.ts:POST]).
- Name and content type come from `x-foundry-name` (default `artifact`) and `content-type` (default `application/octet-stream`) ([route.ts:POST]).
- The returned URL is the signed artifact URL built by `artifactUrl` ([route.ts:POST]).

## Side Effects

- Writes an artifact row and bytes through `storeArtifact` ([route.ts:POST]).

## Verification

- Run: `pnpm test`
