# Handoff brief: Set up Foundry for gckjdev/foundry

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T02:40:24.104Z

## Plan

## Findings

- pnpm 10 workspace + Turbo; Node **22** is genuinely required (vitest 4 / rolldown imports `node:util.styleText`, absent in Node 20.11; a Node-20 install also skips rolldown's native darwin binding). `pnpm install --frozen-lockfile` works and is fast from the shared store.
- `pnpm typecheck` passes (14 tasks, ~5m cold).
- `pnpm test` passes: 92 passed / 8 skipped without a DB, 100/100 with `FOUNDRY_TEST_DATABASE_URL` pointing at the local Postgres (54329). The suite is flaky under parallel load — the live `opencode serve` test times out at 30s and `apps/runner/src/git.ts` can raise an unhandled EPIPE. Serial file execution (`--maxWorkers=1`) passed consistently.
- `pnpm lint` **fails on a clean checkout** with 130 Biome errors (formatting + lint rules), so it cannot be a recipe check.
- `pnpm typecheck` rewrites the tracked `apps/web/tsconfig.tsbuildinfo` (it is the only incremental tsconfig). The runner commits with `git add -A`, so that churn would leak into every PR. I typecheck web separately with `--incremental false`.

## Steps

1. Write `.foundry/recipe.yaml`: install `pnpm install --frozen-lockfile`; checks `typecheck` (turbo for all but web + web tsc non-incremental) and `test` (serial, retry); optional web `dev_server` on `$FOUNDRY_PORT`; `env_file: .env.example`; `system_deps: [node>=22, pnpm, bun]`; `ui_paths: [apps/web/src/**]`.
2. Write `.foundry/policy.yaml`: merge off, CI green required, 3 verify loops, $5 cap, 400-line automerge ceiling, risk rules for database/migrations, auth/tokens, GitHub App + webhooks, runner execution + harnesses, infrastructure/CI/lockfile, proxy + installer security.
3. Write `.github/ISSUE_TEMPLATE/foundry.yml` with required Goal and Acceptance criteria, optional Constraints and Out of scope, default label `foundry`.
4. Clean `node_modules`, reinstall under Node 22 to prove a fresh-checkout install, then run both checks via `mcp__foundry__run_checks` and verify the worktree stays clean.

## Findings

- triage: This is the Foundry monorepo itself: pnpm 10 workspaces + Turbo, Biome for lint, Vitest for tests, Next.js web app, a Bun-compiled runner CLI, and Postgres-backed packages. CI (.github/workflows/ci.yml) runs pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test with Node 22, pnpm, Bun, and a Postgres 16 service.
- investigating: Exact commands are established: install = pnpm install --frozen-lockfile under Node 22; checks = typecheck (all packages except the incremental web tsconfig) and vitest run serially; lint is excluded because it fails on clean main. Test DB suites pass when FOUNDRY_TEST_DATABASE_URL is set and skip otherwise, and the local Postgres on 54329 can supply it.
- implementing: Wrote .foundry/recipe.yaml, .foundry/policy.yaml, and .github/ISSUE_TEMPLATE/foundry.yml; all three parse and validate against the repo's recipe/policy zod schemas, with six risk rules and the required issue-form fields. Now proving install and both checks from a clean node_modules under Node 22.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "dd20a388-5718-49d4-8f52-87181eadba59",
  "title": "Set up Foundry for gckjdev/foundry",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "1b4431a7-588a-4b3a-b00a-c3335c22ea28",
  "plan": "## Findings\n\n- pnpm 10 workspace + Turbo; Node **22** is genuinely required (vitest 4 / rolldown imports `node:util.styleText`, absent in Node 20.11; a Node-20 install also skips rolldown's native darwin binding). `pnpm install --frozen-lockfile` works and is fast from the shared store.\n- `pnpm typecheck` passes (14 tasks, ~5m cold).\n- `pnpm test` passes: 92 passed / 8 skipped without a DB, 100/100 with `FOUNDRY_TEST_DATABASE_URL` pointing at the local Postgres (54329). The suite is flaky under parallel load — the live `opencode serve` test times out at 30s and `apps/runner/src/git.ts` can raise an unhandled EPIPE. Serial file execution (`--maxWorkers=1`) passed consistently.\n- `pnpm lint` **fails on a clean checkout** with 130 Biome errors (formatting + lint rules), so it cannot be a recipe check.\n- `pnpm typecheck` rewrites the tracked `apps/web/tsconfig.tsbuildinfo` (it is the only incremental tsconfig). The runner commits with `git add -A`, so that churn would leak into every PR. I typecheck web separately with `--incremental false`.\n\n## Steps\n\n1. Write `.foundry/recipe.yaml`: install `pnpm install --frozen-lockfile`; checks `typecheck` (turbo for all but web + web tsc non-incremental) and `test` (serial, retry); optional web `dev_server` on `$FOUNDRY_PORT`; `env_file: .env.example`; `system_deps: [node>=22, pnpm, bun]`; `ui_paths: [apps/web/src/**]`.\n2. Write `.foundry/policy.yaml`: merge off, CI green required, 3 verify loops, $5 cap, 400-line automerge ceiling, risk rules for database/migrations, auth/tokens, GitHub App + webhooks, runner execution + harnesses, infrastructure/CI/lockfile, proxy + installer security.\n3. Write `.github/ISSUE_TEMPLATE/foundry.yml` with required Goal and Acceptance criteria, optional Constraints and Out of scope, default label `foundry`.\n4. Clean `node_modules`, reinstall under Node 22 to prove a fresh-checkout install, then run both checks via `mcp__foundry__run_checks` and verify the worktree stays clean.",
  "findings": [
    "triage: This is the Foundry monorepo itself: pnpm 10 workspaces + Turbo, Biome for lint, Vitest for tests, Next.js web app, a Bun-compiled runner CLI, and Postgres-backed packages. CI (.github/workflows/ci.yml) runs pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test with Node 22, pnpm, Bun, and a Postgres 16 service.",
    "investigating: Exact commands are established: install = pnpm install --frozen-lockfile under Node 22; checks = typecheck (all packages except the incremental web tsconfig) and vitest run serially; lint is excluded because it fails on clean main. Test DB suites pass when FOUNDRY_TEST_DATABASE_URL is set and skip otherwise, and the local Postgres on 54329 can supply it.",
    "implementing: Wrote .foundry/recipe.yaml, .foundry/policy.yaml, and .github/ISSUE_TEMPLATE/foundry.yml; all three parse and validate against the repo's recipe/policy zod schemas, with six risk rules and the required issue-form fields. Now proving install and both checks from a clean node_modules under Node 22."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T02:40:24.104Z"
}
```
