# web/src/server

## Overview

Server-only helpers: the singleton control context, session/team authorization
guards, JSON/error response helpers, the runner route wrapper, and a proxy-aware
retrying `fetch`.

## Interface

- `context.ts` — `getContext()` returns the process-wide `ControlContext`; `setContextForTests(ctx)` swaps it for API tests; `ensureWorker()` starts the background worker once ([context.ts]).
- `session.ts` — `TEAM_COOKIE`, `INSTALL_COOKIE`, `requireUser`, `requireTeam`, `requireAdmin` ([session.ts]).
- `http.ts` — `json(body, status?)`, `errorResponse(err)`, `runnerRoute(schema, handler)` ([http.ts]).
- `retry-fetch.ts` — `proxiedFetch`, `githubFetch`, `installProxiedFetch()`, deprecated alias `installGithubFetchRetry` ([retry-fetch.ts]).

## Invariants

- The context is built once and cached on `globalThis`; missing `FOUNDRY_SECRET` throws ([context.ts:build]).
- `requireUser` redirects to `/signin` without a session; `requireTeam` redirects to `/setup` when the user has no teams and otherwise honors the `foundry_team` cookie, falling back to the first team ([session.ts]).
- Auth/team lookups are wrapped in React `cache` so one request performs them once ([session.ts]).
- `runnerRoute` authenticates the bearer token, validates the JSON body with the provided Zod schema, and maps `ZodError`→400, `Unauthorized`→401, `Forbidden`→403, `NotFound`→404, `Conflict`/`InvalidTransition`→409, else 500 (details hidden in production) ([http.ts]).
- `proxiedFetch` proxies only URLs that `shouldUseHttpProxy` accepts, retries 5 times with exponential backoff, and makes the last attempt direct so a dead proxy is not fatal ([retry-fetch.ts:proxiedFetch]).
- `installProxiedFetch` wraps `globalThis.fetch` idempotently and only for `http(s)` URLs that should be proxied ([retry-fetch.ts:installProxiedFetch]).

## Side Effects

- Opens DB and GitHub clients, builds transports/notifier, and starts the control worker ([context.ts]).
- Sets `globalThis.fetch` and applies proxy environment variables ([retry-fetch.ts:installProxiedFetch]).
- Reads/writes auth and team cookies during navigation ([session.ts]).

## Verification

- Run: `pnpm test`
