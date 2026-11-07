# Foundry

Foundry turns GitHub issues into verified, merged pull requests. Coding agents (Claude Code or OpenCode) run on your team's own Mac and Linux machines, follow a fixed playbook (triage, investigate, implement, verify, PR), and a confidence gate decides whether a change merges itself or goes to a human.

Product spec: `software-factory-product-spec.md` (v0.5).

## Layout

| Path                   | What it is                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `apps/web`             | Control plane: Next.js panel, API routes, webhook ingest, runner API                        |
| `apps/realtime`        | Postgres LISTEN/NOTIFY to WebSocket fan-out                                                 |
| `apps/runner`          | Runner daemon and `foundry` CLI (Bun, compiled per platform)                                |
| `packages/shared`      | zod schemas, state machine, gate, scheduler, GitHub comment templates                       |
| `packages/db`          | Drizzle schema, SQL migrations, NOTIFY triggers                                             |
| `packages/control`     | Control-plane services: ingest, jobs, claiming, questions, gate, sweeper, notifier, metrics |
| `packages/github`      | GitHub App client (and an in-memory fake for tests)                                         |
| `packages/harness-*`   | Harness adapter interface, Claude Code and OpenCode adapters                                |
| `packages/mcp-foundry` | Per-job MCP server: `stage`, `ask`, `evidence`, `confidence`, `plan`                        |
| `packages/os-adapters` | macOS and Linux adapters (service, user, secrets, limits, sleep, idle, power)               |
| `packages/playbooks`   | Default playbook and prompt assembly                                                        |
| `deploy/`              | Docker Compose stack (web, realtime, Postgres, Caddy)                                       |

## Development

```bash
pnpm install
cp .env.example .env            # fill in GitHub App + OAuth values
docker compose -f deploy/compose.yaml up -d postgres   # or any Postgres 16+
pnpm db:migrate
pnpm dev                        # web on :3000, realtime on :3001
pnpm dev:webhooks               # forward GitHub webhooks via smee.io
```

Restart the control plane: **Ctrl+C** in that terminal, then `pnpm dev` again. If ports 3000/3001 stay busy: `lsof -ti tcp:3000,3001 | xargs kill` then `pnpm dev`. The runner is separate — Ctrl+C in its terminal, then `pnpm dev:runner`. Details: `docs/local-setup.md` §4.

The runner is a separate process (join a team first, then start it):

```bash
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000
pnpm dev:runner
```

Tests: `pnpm test` (set `FOUNDRY_TEST_DATABASE_URL` to a Postgres you can create databases on, otherwise database tests are skipped).

See `docs/local-setup.md` for GitHub App URLs, `.env` (including `FOUNDRY_HTTP_PROXY`), local Postgres, and Docker Compose deploy. Repo onboarding (join token, runner, recipe PR) is `docs/onboarding.md`.
