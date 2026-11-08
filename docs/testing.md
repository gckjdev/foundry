# Testing architecture

> 中文版本: [testing.zh-CN.md](testing.zh-CN.md)

Foundry uses three layers. Shared fakes and fixtures live in `tests/helpers.ts` (re-exports of `@foundry/control/testing`, `@foundry/db/testing`, `FakeGitHub`, `FakeHarness`). Prefer those over one-off Postgres or GitHub setup.

| Layer               | What it proves                                                                 | How to run                                  | Needs                                   |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------- |
| **Unit**            | Pure logic, adapters, runner with git fixtures                                 | `pnpm test:unit`                            | nothing                                 |
| **Component / API** | Control plane + Next route handlers against a throwaway database               | `pnpm test:api`                             | `FOUNDRY_TEST_DATABASE_URL`             |
| **E2E**             | In-process job loop (`tests/e2e`) and the panel in a real browser (Playwright) | `pnpm test --project e2e` · `pnpm test:e2e` | DB for job e2e; Chromium for Playwright |

`pnpm test` runs the Vitest projects (unit + api + in-process e2e). Database cases **skip** when `FOUNDRY_TEST_DATABASE_URL` is unset. Playwright is separate so jobs that only need Vitest stay fast.

## Layer 1 — unit

Colocated `*.test.ts` next to the code:

- `packages/shared`, `github`, `harness-*`, `os-adapters`, `mcp-foundry`, `playbooks`
- `apps/runner` (git fixture + `FakeHarness` + `RecordingControlPlane`)
- `apps/realtime`

No control-plane Postgres. Git tests set `FOUNDRY_GIT_BASE=file://…`.

### GitHub HTTP — undici `MockAgent`

Control-plane tests keep `FakeGitHub` (`setGitHub`). That stand-in does not run `OctokitGitHubClient`.

Cover the real client with undici `MockAgent`, as in `packages/github/src/octokit.mock.test.ts`. `@foundry/github` depends on `undici` for this.

- `OctokitGitHubClient` calls `globalThis.fetch`. `setGlobalDispatcher(agent)` makes Node’s fetch hit the mock. Save the previous dispatcher and restore it in `afterAll`.
- `agent.disableNetConnect()` so a forgotten stub fails instead of calling `api.github.com`.
- App auth signs the JWT locally. The HTTP call is `POST /app/installations/:id/access_tokens`. `persist()` that intercept; installation methods do not run without it.
- Match the path with a function and ignore `?per_page=100`. Paginate stops when the response has no `Link` header.
- Request bodies arrive as async iterables. Read them before branching (GraphQL is one `POST /graphql`).
- Do not point a global `MockAgent` at `apps/web/src/server/retry-fetch.ts`. That helper calls `undici.fetch` with a `ProxyAgent` dispatcher, which skips the global mock.

## Layer 2 — component / API

- **Component:** `packages/control/src/control.test.ts`, `packages/db/src/db.test.ts` — real schema, `FakeGitHub`, `createTestEnv()`.
- **API:** `tests/api/*.test.ts` — import Next `POST` handlers, inject the test control plane with `setContextForTests`. Shims: `tests/shims/server-only.ts`, `tests/shims/next-server.ts` (so `after()` from `next/server` is awaitable).

`FOUNDRY_TEST_DATABASE_URL` must be a Postgres that may `CREATE DATABASE`. Prefer the same server as `.env`, **not** the `foundry` app database.

## Layer 3 — e2e

- **In-process:** `tests/e2e/harness.ts` (`createE2E`, `GitBackedGitHub`, `DirectControlPlane`) plus `tests/e2e/job.test.ts`. A real daemon on a throwaway DB; the model is `FakeHarness`. Heavier job paths (auto-merge, ask, portable resume) belong in a follow-up, not this kit’s smoke test.
- **Playwright:** `tests/playwright/*.spec.ts`. Starts `next dev` on port 3456 **without** `DATABASE_URL` so the worker stays off; `/signin` is public. Point at a live panel with `FOUNDRY_E2E_BASE_URL`. Install the browser once: `pnpm exec playwright install chromium`. `@playwright/test` is pinned to 1.48 so Chromium still installs on macOS 12.

## Coverage report

```bash
FOUNDRY_TEST_DATABASE_URL=postgres://USER@HOST:PORT/postgres pnpm test:report
```

Writes `coverage/` (gitignored HTML/LCOV) and `docs/testing-report.md` (committed snapshot of rates).
