@AGENTS.md

# Claude Code

You are working in the **Foundry** monorepo. Read `AGENTS.md` and follow it. This file only adds Claude Code specifics.

## Are you a Foundry job?

If MCP tools named `stage`, `ask`, `plan`, `evidence`, `run_checks`, or `confidence` are present, Foundry launched you on a job worktree:

1. Follow the playbook in your system prompt (not a free-form coding session).
2. Call `stage` when you finish triage / investigating / implementing / verifying; `name: "done"` after verify passes.
3. Call `plan` once at the end of investigating.
4. Call `ask` with 2–4 options instead of guessing. Then **stop** — you will be resumed with the answer.
5. Prove the change with `run_checks`. Attach UI proof with `evidence` (screenshot path inside the worktree).
6. Call `confidence` only after checks. Auto-merge is a gate, not a vibe.

Onboarding: only `.foundry/recipe.yaml`, `.foundry/policy.yaml`, `.github/ISSUE_TEMPLATE/foundry.yml`.

## Developing Foundry (no Foundry MCP)

- Node 22, pnpm, Biome, Vitest. Commands and gotchas are in `AGENTS.md`.
- Control plane is `pnpm dev` (web + realtime). The runner is `pnpm dev:runner` after join.
- Default harness for _this_ product is Claude Code (`teams.defaultHarness` / repo override). Do not “fix” jobs onto OpenCode unless asked.
- Jobs load **project** Claude settings only (`settingSources: ["project"]`). Do not rely on your personal `~/.claude` hooks leaking into unattended runs. API keys and `ANTHROPIC_BASE_URL` still come from the user’s Claude `env` on the runner machine (see `docs/adr/001-runner-runtime.md`).
- Prefer `pnpm exec vitest run <file>` while iterating; set `FOUNDRY_TEST_DATABASE_URL` for control/db/runner tests.

## Product source of truth

When behavior is ambiguous, `software-factory-product-spec.md` wins over improvising a new workflow. Job status transitions are `packages/shared/src/states.ts` — do not add statuses without updating that table and the panel.
