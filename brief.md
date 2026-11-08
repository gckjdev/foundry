# Handoff brief: Document every .foundry/ recipe and policy field

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T05:22:28.562Z

## Plan

1. Create `docs/foundry-dot-dir.md`:
   - Files table: `recipe.yaml` (required for ticket jobs), `policy.yaml` (optional, defaults when missing/invalid), `playbook.md`, `playbook.<name>.md`, `playbook.<harness>.md`, `skills/*.md`, and `.github/ISSUE_TEMPLATE/foundry.yml`.
   - Variable expansion section: `$FOUNDRY_JOB_ID`, `$FOUNDRY_PORT`, `$FOUNDRY_PORT_END` (+ `FOUNDRY_BRANCH`), `expandRecipeVars` in `dev_server.run`, shell env for other commands, ports block semantics.
   - `RecipeSchema` field reference (type, default, runner behavior) for `install`, `checks[]` (`name`, `run`, `timeout_sec`), `dev_server` (`run`, `ready_path`, `timeout_sec`), `services.postgres.database`, `env_file`, `system_deps`, `warm`, `os`, `ui_paths`.
   - `PolicySchema` field reference for `merge`, `require_ci_green`, `require_ai_review_clean`, `ai_review_bots`, `max_verify_loops`, `max_cost_per_job_usd`, `max_diff_lines_for_automerge`, `max_job_minutes`, `permissions.deny_commands`, `permissions.allow_web_fetch`, and `risk_rules[]` (`name`, `paths`, `diff_regex`, `reviewers`).
   - One minimal example per file using only real schema fields/defaults.
2. Add one-line links to `README.md` and `docs/onboarding.md`.
3. Verify doc against `packages/shared/src/recipe.ts` and `policy.ts`; run `mcp__foundry__run_checks` (lint, typecheck, test) since no runtime code changes.
4. Confirm no new runtime behavior and no duplication of the local-setup runbook.

## Findings

- triage: Ticket is clear: add a docs-only reference for every .foundry/ file and every RecipeSchema/PolicySchema field, link it from README.md and docs/onboarding.md. Source-of-truth schemas and runner usage located.
- investigating: Investigation confirmed exact runner behavior for each field: install/warm/checks in job-runner and readiness, env_file copy, services provisioning, screenshot-driven dev_server, ui_paths detection, and the gate/policy rules. Writing the reference doc plus two links.
- implementing: Added docs/foundry-dot-dir.md covering every .foundry/ file, all RecipeSchema and PolicySchema fields with types/defaults/runner behavior, variable expansion, and minimal examples; linked it from README.md and docs/onboarding.md. No runtime code changed.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "3c4b2d84-6d7a-4901-b8b4-cbc4da64d02f",
  "title": "Document every .foundry/ recipe and policy field",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "d5cd870f-0da2-47d7-8730-e50d8a75e6b3",
  "plan": "1. Create `docs/foundry-dot-dir.md`:\n   - Files table: `recipe.yaml` (required for ticket jobs), `policy.yaml` (optional, defaults when missing/invalid), `playbook.md`, `playbook.<name>.md`, `playbook.<harness>.md`, `skills/*.md`, and `.github/ISSUE_TEMPLATE/foundry.yml`.\n   - Variable expansion section: `$FOUNDRY_JOB_ID`, `$FOUNDRY_PORT`, `$FOUNDRY_PORT_END` (+ `FOUNDRY_BRANCH`), `expandRecipeVars` in `dev_server.run`, shell env for other commands, ports block semantics.\n   - `RecipeSchema` field reference (type, default, runner behavior) for `install`, `checks[]` (`name`, `run`, `timeout_sec`), `dev_server` (`run`, `ready_path`, `timeout_sec`), `services.postgres.database`, `env_file`, `system_deps`, `warm`, `os`, `ui_paths`.\n   - `PolicySchema` field reference for `merge`, `require_ci_green`, `require_ai_review_clean`, `ai_review_bots`, `max_verify_loops`, `max_cost_per_job_usd`, `max_diff_lines_for_automerge`, `max_job_minutes`, `permissions.deny_commands`, `permissions.allow_web_fetch`, and `risk_rules[]` (`name`, `paths`, `diff_regex`, `reviewers`).\n   - One minimal example per file using only real schema fields/defaults.\n2. Add one-line links to `README.md` and `docs/onboarding.md`.\n3. Verify doc against `packages/shared/src/recipe.ts` and `policy.ts`; run `mcp__foundry__run_checks` (lint, typecheck, test) since no runtime code changes.\n4. Confirm no new runtime behavior and no duplication of the local-setup runbook.",
  "findings": [
    "triage: Ticket is clear: add a docs-only reference for every .foundry/ file and every RecipeSchema/PolicySchema field, link it from README.md and docs/onboarding.md. Source-of-truth schemas and runner usage located.",
    "investigating: Investigation confirmed exact runner behavior for each field: install/warm/checks in job-runner and readiness, env_file copy, services provisioning, screenshot-driven dev_server, ui_paths detection, and the gate/policy rules. Writing the reference doc plus two links.",
    "implementing: Added docs/foundry-dot-dir.md covering every .foundry/ file, all RecipeSchema and PolicySchema fields with types/defaults/runner behavior, variable expansion, and minimal examples; linked it from README.md and docs/onboarding.md. No runtime code changed."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T05:22:28.562Z"
}
```
