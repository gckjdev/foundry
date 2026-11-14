# packages

## Overview

The `packages/` subsystem of the Foundry monorepo: shared libraries, the control-plane domain layer, GitHub/database/runtime adapters and the per-job MCP server. `apps/` (web, realtime, runner) consume these packages; no package imports an app. Workspace names are `@foundry/<directory>` and every package exports TypeScript source, not a build output.

## Subdirectories & Boundaries

- [control](./control/EGM.md): job lifecycle, claim, ingest, gate, PR review, runners, metrics, sweeper.
- [db](./db/EGM.md): Drizzle schema, migrations and test-database helpers.
- [github](./github/EGM.md): `GitHubClient` interface, Octokit and fake implementations, webhook verification.
- [harness-core](./harness-core/EGM.md): harness adapter contract, `FakeHarness`, event queue, log and skill helpers.
- [harness-claude-code](./harness-claude-code/EGM.md): Claude Code Agent SDK harness.
- [harness-opencode](./harness-opencode/EGM.md): OpenCode localhost server harness.
- [mcp-foundry](./mcp-foundry/EGM.md): per-job MCP tools (`stage`, `plan`, `ask`, `evidence`, `run_checks`, `confidence`, `review`).
- [os-adapters](./os-adapters/EGM.md): macOS/Linux/Windows secrets, services, sleep and process control.
- [playbooks](./playbooks/EGM.md): prompt assembly and built-in playbooks/skills.
- [shared](./shared/EGM.md): Zod schemas, state machine, gate, policy/recipe, proxy, logging and formatting.

## Interface

- Each subdirectory is a workspace package `@foundry/<name>` exporting TypeScript source from its `src/index.ts`; see the per-package contracts above for symbols.
- Cross-package imports use the `@foundry/<name>` specifier and `workspace:*` versions `[./control/package.json:dependencies]`.

## Invariants

- Dependency direction is acyclic: `shared` depends on no workspace package, `control` sits above `db`/`github`/`playbooks`/`shared`, and harnesses depend on `harness-core`/`os-adapters`/`shared` `[./shared/EGM.md][./control/EGM.md]`.
- Job status transitions are defined once in `@foundry/shared/states` and must not be redefined here `[./shared/src/EGM.md]`.
- All package exports point at `src/*.ts`; there is no `dist` to build `[./control/package.json:exports]`.
- Outbound HTTP goes through `@foundry/shared/proxy`; GitHub tokens stay in `http.extraheader` `[./shared/src/EGM.md]`.

## Side Effects

- Runtime I/O is concentrated in `control`/`db` (Postgres), `github` (GitHub API), the harnesses (model processes), `mcp-foundry` (local socket) and `os-adapters` (system commands).
- Importing any package is side-effect-free; I/O happens only inside called functions.

## Verification

- Run: `pnpm test`
