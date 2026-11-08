# Foundry

> 中文版本: [README.zh-CN.md](README.zh-CN.md)

Foundry turns GitHub issues into verified, merged pull requests. Coding agents (Claude Code or OpenCode) run on your team's own Mac and Linux machines, follow a fixed playbook (triage, investigate, implement, verify, PR), and a confidence gate decides whether a change merges itself or goes to a human.

Product spec: `software-factory-product-spec.md` (v0.5).

New to the idea? Start with [docs/introduction.md](docs/introduction.md) — a beginner-friendly guide to
software factories and how Foundry implements one.

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

Several jobs on one daemon: re-join with `--concurrency N`. A second daemon on the same login needs its own `--name` and `--home` (`docs/local-setup.md` §3).

Tests: `pnpm test` (unit + API + in-process e2e). Set `FOUNDRY_TEST_DATABASE_URL` to a Postgres you can create databases on, otherwise database tests are skipped. Browser e2e: `pnpm test:e2e`. Coverage: `pnpm test:report`. See `docs/testing.md`.

See `docs/local-setup.md` for GitHub App URLs, `.env` (including `FOUNDRY_HTTP_PROXY`), local Postgres, and Docker Compose deploy. Repo onboarding (join token, runner, recipe PR) is `docs/onboarding.md`. Field reference for every file under `.foundry/` and every `recipe.yaml` / `policy.yaml` field is `docs/foundry-dot-dir.md`.

## Documentation

Every human-facing document has a Chinese version.

| Document                              | English                                                              | 中文                                                                             |
| ------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Introduction to software factories    | [docs/introduction.md](docs/introduction.md)                         | [docs/introduction.zh-CN.md](docs/introduction.zh-CN.md)                         |
| Product spec                          | [software-factory-product-spec.md](software-factory-product-spec.md) | [software-factory-product-spec.zh-CN.md](software-factory-product-spec.zh-CN.md) |
| Overall solution design               | [docs/design/overall-design.md](docs/design/overall-design.md)       | [docs/design/overall-design.zh-CN.md](docs/design/overall-design.zh-CN.md)       |
| Component solution design             | [docs/design/components.md](docs/design/components.md)               | [docs/design/components.zh-CN.md](docs/design/components.zh-CN.md)               |
| Core use cases and sequence diagrams  | [docs/design/use-cases.md](docs/design/use-cases.md)                 | [docs/design/use-cases.zh-CN.md](docs/design/use-cases.zh-CN.md)                 |
| Configuration, install and deploy     | [docs/local-setup.md](docs/local-setup.md)                           | [docs/local-setup.zh-CN.md](docs/local-setup.zh-CN.md)                           |
| Repo onboarding                       | [docs/onboarding.md](docs/onboarding.md)                             | [docs/onboarding.zh-CN.md](docs/onboarding.zh-CN.md)                             |
| `.foundry/` field reference           | [docs/foundry-dot-dir.md](docs/foundry-dot-dir.md)                   | [docs/foundry-dot-dir.zh-CN.md](docs/foundry-dot-dir.zh-CN.md)                   |
| Testing architecture                  | [docs/testing.md](docs/testing.md)                                   | [docs/testing.zh-CN.md](docs/testing.zh-CN.md)                                   |
| Testing coverage snapshot             | [docs/testing-report.md](docs/testing-report.md)                     | [docs/testing-report.zh-CN.md](docs/testing-report.zh-CN.md)                     |
| ADR 001: runner runtime and packaging | [docs/adr/001-runner-runtime.md](docs/adr/001-runner-runtime.md)     | [docs/adr/001-runner-runtime.zh-CN.md](docs/adr/001-runner-runtime.zh-CN.md)     |
| Agent instructions                    | [AGENTS.md](AGENTS.md)                                               | not translated (per ticket)                                                      |
| Claude Code notes                     | [CLAUDE.md](CLAUDE.md)                                               | not translated (per ticket)                                                      |
