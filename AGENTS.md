# Foundry — agent instructions

Foundry turns GitHub issues into verified, merged PRs. Coding agents (Claude Code or OpenCode) run on the team’s Mac/Linux machines, follow a fixed playbook, and a confidence gate decides auto-merge vs human review.

This file is for **anyone changing this repository** (Cursor, Claude Code, OpenCode, Codex). Product behavior lives in `software-factory-product-spec.md`. Local runbook: `docs/local-setup.md`. Onboarding a repo: `docs/onboarding.md`. Runner packaging: `docs/adr/001-runner-runtime.md`. Panel visual identity and design tokens: `DESIGN.md`.

## Two modes

| Mode                   | How you know                                                                            | What to do                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Developing Foundry** | No `foundry` MCP tools (`stage`, `ask`, `plan`, `evidence`, `run_checks`, `confidence`) | Change this codebase. Follow the rest of this file.                                                                                                                 |
| **Foundry job**        | Those MCP tools are available                                                           | You are on a job worktree. Follow the injected playbook. Call `stage` as you go; `ask` instead of guessing; `run_checks` before `confidence`. Do not skip the gate. |

Onboarding jobs must only add `.foundry/recipe.yaml`, `.foundry/policy.yaml`, and `.github/ISSUE_TEMPLATE/foundry.yml` — no application-code changes.

## Stack

- **Node 22+**, **pnpm 10** (`packageManager` in root `package.json`). Never npm or yarn.
- **TypeScript strict**, ESM (`"type": "module"`). Packages export source (`.ts`), not `dist`.
- **Biome** for lint/format (2-space indent, line width 110, double quotes, semicolons). `noNonNullAssertion` is off.
- **Vitest 4** at the repo root. **Turborepo** for `dev` / `build` / `typecheck`.
- **Next.js 16** App Router + **Auth.js 5** GitHub provider (`apps/web`).
- **Drizzle** + **postgres.js** (`packages/db`). Migrations in `packages/db/migrations`.
- **Bun** only for the runner CLI (`apps/runner`). Runner _source_ must use `node:` APIs — no `bun:` imports — so Vitest can run it. Playbook `.md` files are imported `with { type: "text" }`; `vitest.config.ts` mirrors that.
- Workspace packages are `@foundry/<name>` via `workspace:*`.

## Commands

```bash
pnpm install
pnpm db:migrate                          # DATABASE_URL
pnpm dev                                 # web :3000 + realtime :3001 only
pnpm dev:webhooks                        # smee.io → /api/webhooks/github
pnpm dev:runner                          # after `runner join`; not started by pnpm dev
pnpm lint                                # biome check .
pnpm format
pnpm typecheck
pnpm test                                # vitest run
```

Restart control plane: Ctrl+C, then `pnpm dev`. If 3000/3001 stay busy: `lsof -ti tcp:3000,3001 | xargs kill`. Runner is a separate process.

**Do not** expect `pnpm dev` to start the runner. It fails with `not joined yet` until a team exists and a runner has joined.

### Tests

Three layers — details in `docs/testing.md`, rates in `docs/testing-report.md`:

| Layer           | Command                                     | What                                                                         |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Unit            | `pnpm test:unit`                            | Colocated `*.test.ts` (shared, harnesses, runner git fixtures). No Postgres. |
| Component / API | `pnpm test:api`                             | Control plane, DB, and Next route handlers against a throwaway database.     |
| E2E             | `pnpm test --project e2e` · `pnpm test:e2e` | In-process job loop (`FakeHarness`) and Playwright against `/signin`.        |

`pnpm test` runs every Vitest project. Database tests **skip** unless:

```bash
FOUNDRY_TEST_DATABASE_URL=postgres://USER@HOST:PORT/postgres pnpm test
```

That URL must be allowed to `CREATE DATABASE`. Prefer the same Postgres as `.env`, not the `foundry` app database. Isolation: `pnpm exec vitest run path/to/file.test.ts`.

Reuse `tests/helpers.ts` (`createTestEnv`, `FakeGitHub`, `FakeHarness`, `jsonRequest`). Inject the control plane into route tests with `setContextForTests`. Do not stand up a one-off database or GitHub fake.

`FakeGitHub` does not exercise `OctokitGitHubClient`. Cover that HTTP client with undici `MockAgent` (`packages/github/src/octokit.mock.test.ts`): `setGlobalDispatcher`, `disableNetConnect()`, `persist()` the installation-token `POST`, then restore the previous dispatcher. Details in `docs/testing.md`. `retry-fetch.ts` sends through a `ProxyAgent`, so a global `MockAgent` does not see it.

Coverage snapshot: `pnpm test:report` (writes `docs/testing-report.md`). Playwright needs Chromium once: `pnpm exec playwright install chromium`.

Live OpenCode tests skip when `opencode` is not on PATH. They start a real `opencode serve` (slow; 60s startup budget).

Recipe CI (`.foundry/recipe.yaml`) runs typecheck with `--incremental false` on `@foundry/web` so `tsconfig.tsbuildinfo` is not dirtied, and tests with `--maxWorkers=1`.

## Layout

| Path                   | Role                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `apps/web`             | Control plane: panel, Auth.js, webhook ingest, runner HTTP API              |
| `apps/realtime`        | Postgres LISTEN/NOTIFY → WebSocket (`:3001`)                                |
| `apps/runner`          | Join/heartbeat/claim, worktrees, harnesses, `foundry` CLI                   |
| `packages/control`     | Jobs, claim, ingest, gate, onboarding, metrics, questions                   |
| `packages/db`          | Schema, SQL migrations, NOTIFY triggers                                     |
| `packages/shared`      | Zod schemas, job state machine, policy/recipe, proxy, gate                  |
| `packages/github`      | GitHub App Octokit + in-memory fake                                         |
| `packages/harness-*`   | Adapter interface, Claude Code, OpenCode                                    |
| `packages/mcp-foundry` | Per-job MCP: `stage`, `ask`, `plan`, `evidence`, `run_checks`, `confidence` |
| `packages/os-adapters` | macOS / Linux (sleep, secrets, limits)                                      |
| `packages/playbooks`   | Built-in playbooks (`default`, `bugfix`, `feature`, `onboarding`)           |
| `deploy/`              | Compose stack for a public host                                             |
| `.foundry/`            | This repo’s own recipe + policy (dogfooding)                                |

Job statuses and legal transitions: `packages/shared/src/states.ts`. Do not invent transitions; use `assertTransition` / `transitionJob`.

Runner stages in order: `triage` → `investigating` → `implementing` → `verifying` → PR.

## Conventions

- **Smallest package.** Business rules in `packages/control` or `packages/shared`, not in Next route handlers. Routes should parse, auth, call control, return.
- **Zod at boundaries.** Shared types live in `@foundry/shared`. GitHub payloads go through `@foundry/github`.
- **ISO timestamps in SQL.** Nested Drizzle `sql` fragments stringify `Date` with the locale (`Sat Oct 10 2026 … (中国标准时间)`), which Postgres rejects. Pass `.toISOString()` and cast `::timestamptz` (see `packages/control/src/metrics.ts`).
- **Proxy every outbound HTTP** through `FOUNDRY_HTTP_PROXY` (then `HTTPS_PROXY` / `HTTP_PROXY`, then macOS `scutil`). Localhost is excluded (`FOUNDRY_NO_PROXY`). Implementation: `@foundry/shared/proxy`, web `retry-fetch`, runner `git.ts`. **Do not** send `file://` git remotes (tests set `FOUNDRY_GIT_BASE`) through the HTTP proxy.
- **GitHub tokens** stay in `http.extraheader`, never in the remote URL or argv that error messages print.
- **Secrets:** `.env`, `github-app.pem`, `*.pem` are gitignored. Never commit them, never paste them into docs or logs. Redact proxy userinfo.
- **Generated files:** `next-env.d.ts` and `*.tsbuildinfo` are gitignored. Do not add them back.
- **UI:** verify in the browser when you change panel behavior (user rule). `pnpm dev` does not include the runner.
- **UI tokens:** `DESIGN.md` is the visual identity source of truth for the panel, and its tokens mirror `apps/web/src/app/globals.css`. Change both together and run `pnpm dlx @google/design.md lint DESIGN.md`.

## Where to look

| Change                               | Start here                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Job lifecycle / claim / fail / retry | `packages/control/src/jobs.ts`, `claim.ts`, `onboarding.ts`                         |
| GitHub webhooks → jobs               | `packages/control/src/ingest.ts`, `apps/web/src/app/api/webhooks/github`            |
| Sign-in / App install                | `apps/web/src/auth.ts`, `apps/web/src/server/retry-fetch.ts`                        |
| Merge gate                           | `packages/control/src/merge-gate.ts`, `packages/shared/src/gate.ts`                 |
| Panel pages                          | `apps/web/src/app/(panel)/`                                                         |
| Panel visual design / tokens         | `DESIGN.md`, `apps/web/src/app/globals.css`                                         |
| Runner loop                          | `apps/runner/src/daemon.ts`, `job-runner.ts`, `git.ts`                              |
| Harness                              | `packages/harness-core`, `harness-claude-code`, `harness-opencode`                  |
| Recipe / policy schemas              | `packages/shared/src/recipe.ts`, `policy.ts`                                        |
| Outbound proxy                       | `packages/shared/src/proxy.ts`                                                      |
| Tests (unit / API / e2e)             | `docs/testing.md`, `tests/helpers.ts`, `tests/api`, `tests/e2e`, `tests/playwright` |

## Do not

- Add Docker as a hard requirement. Local Postgres is a supported control-plane database.
- Start or “fix” the runner from `pnpm dev`. Join first (`docs/onboarding.md`).
- Put tokens or `.env` values in source, tests, or markdown.
- Use `Date` objects inside nested `sql\`...\`` fragments.
- Import `bun:` from runner or shared packages.
- Widen `any` to silence Biome (`noExplicitAny` is warn — fix the type).
- Drive-by refactors or new markdown files the user did not ask for.
- Claim tests/types pass without running the commands (or a targeted Vitest file plus `pnpm exec biome check` on touched files).

## Verify before you finish

For a behavior change:

```bash
pnpm exec biome check --write <touched-files>
pnpm typecheck
FOUNDRY_TEST_DATABASE_URL=... pnpm test    # or vitest run on the affected files
```

Typecheck is slow (minutes). If you only touched one package, `pnpm --filter @foundry/<name> typecheck` is enough _in addition to_ tests for that area; run full `pnpm typecheck` before a PR.

Machine-specific ports, GitHub App IDs, and proxy URLs: `docs/local-setup.md` (not this file).
