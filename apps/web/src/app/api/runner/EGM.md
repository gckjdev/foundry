# web/src/app/api/runner

## Overview

The bearer-token HTTP API the runner daemon calls. Every route authenticates
the runner token and scopes work to a runner-owned job except `join`, which is
unauthenticated and consumes a one-time `fdj_` join token.

## Subdirectories & Boundaries

- artifacts: [./artifacts/EGM.md](./artifacts/EGM.md) — raw artifact upload.
- claim: [./claim/EGM.md](./claim/EGM.md) — claim the next job.
- git-token: [./git-token/EGM.md](./git-token/EGM.md) — installation token for a repo.
- heartbeat: [./heartbeat/EGM.md](./heartbeat/EGM.md) — daemon telemetry and command channel.
- jobs: [./jobs/EGM.md](./jobs/EGM.md) — per-job progress actions.
- join: [./join/EGM.md](./join/EGM.md) — register a runner (join token).
- readiness: [./readiness/EGM.md](./readiness/EGM.md) — report recipe readiness.

## Invariants

- All routes except `join` use `runnerRoute`, which authenticates `Authorization: Bearer <runnerToken>` and returns the standard error mapping ([../server/http.ts:runnerRoute]).
- Request bodies are validated with the Zod schemas in `@foundry/shared` ([heartbeat/route.ts], [readiness/route.ts], [jobs/\[id\]/\[action\]/route.ts]).
- Runner-owned job access goes through `ownedJob`/the `runner*` control functions; a job not owned by the caller is rejected ([artifacts/route.ts], [jobs/\[id\]/\[action\]/route.ts]).
