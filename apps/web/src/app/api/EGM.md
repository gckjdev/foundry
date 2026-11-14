# web/src/app/api

## Overview

Next.js route handlers for browser, GitHub, and runner traffic. The tree splits
into panel-facing endpoints (artifacts, auth, push, realtime token, job events),
GitHub setup/webhooks, and the bearer-token runner API.

## Subdirectories & Boundaries

- artifacts: [./artifacts/EGM.md](./artifacts/EGM.md) — signed artifact download by id.
- auth: [./auth/EGM.md](./auth/EGM.md) — Auth.js catch-all handler.
- github: [./github/EGM.md](./github/EGM.md) — GitHub App setup callback.
- jobs: [./jobs/EGM.md](./jobs/EGM.md) — per-job incremental events for the live log.
- push: [./push/EGM.md](./push/EGM.md) — Web Push public key and subscription.
- realtime-token: [./realtime-token/EGM.md](./realtime-token/EGM.md) — mints the panel WebSocket token.
- runner: [./runner/EGM.md](./runner/EGM.md) — bearer-token API used by the daemon.
- webhooks: [./webhooks/EGM.md](./webhooks/EGM.md) — GitHub webhook ingest.

## Invariants

- Panel-facing routes authorize through `requireTeam`/`requireAdmin`; runner routes authorize with `authenticateRunner` and a bearer token ([../server/http.ts:runnerRoute], [../server/session.ts]).
- Error mapping is centralized in `errorResponse` (`../server/http.ts`).
