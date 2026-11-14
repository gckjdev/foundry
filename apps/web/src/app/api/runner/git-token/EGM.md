# web/src/app/api/runner/git-token

## Overview

Issues a short-lived GitHub installation token the runner uses for git
operations on one repo.

## Interface

- `POST` with `{ repoId: string }` — returns `runnerGitToken(ctx, runner, body.repoId)` ([route.ts:POST]).

## Invariants

- `repoId` is required and validated by Zod ([route.ts:POST]).
- The token is scoped to the repo and runner by `runnerGitToken`; the runner must be authenticated ([route.ts:POST]).
- The token is never written to the remote URL by the runner (see runner `git.ts`) ([route.ts:POST]).

## Side Effects

- Requests an installation token from GitHub via `@foundry/control`/`@foundry/github`.

## Verification

- Run: `pnpm test`
