# `.foundry/` directory reference

> 中文版本: [foundry-dot-dir.zh-CN.md](foundry-dot-dir.zh-CN.md)

`docs/onboarding.md` explains how Foundry creates these files. This page is the field reference: every file
Foundry reads from `.foundry/`, every field in `recipe.yaml` and `policy.yaml`, and what the runner and the
confidence gate do with it.

Source of truth: `packages/shared/src/recipe.ts` (`RecipeSchema`) and `packages/shared/src/policy.ts`
(`PolicySchema`). Both YAML files are parsed with zod; unknown keys are ignored.

## Files

| File                                 | Required | What it is                                                                                                                                                                  |
| ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.foundry/recipe.yaml`               | Yes      | How to install, check and run the repo. A ticket job fails to start without a valid recipe.                                                                                 |
| `.foundry/policy.yaml`               | No       | Merge mode, budgets, permissions and risk rules. Missing or invalid falls back to `DEFAULT_POLICY` (the defaults below).                                                    |
| `.foundry/playbook.md`               | No       | Replaces the built-in `default` playbook for ticket jobs.                                                                                                                   |
| `.foundry/playbook.<name>.md`        | No       | Replaces a named built-in playbook (`bugfix`, `feature`) or supplies a new one. Select it with the `playbook:<name>` issue label.                                           |
| `.foundry/playbook.<harness>.md`     | No       | Extra notes appended to the system prompt for that harness (`claude-code` or `opencode`).                                                                                   |
| `.foundry/skills/*.md`               | No       | Repo knowledge appended to the system prompt, one section per file, sorted by filename.                                                                                     |
| `.claude/skills/<name>/SKILL.md`     | No       | Skill Claude Code loads natively. Onboarding installs the built-in skills (`merge-risk`, `show-me`, `resolve-merge-conflicts`) here; refresh with `foundry skills install`. |
| `.opencode/skills/<name>/SKILL.md`   | No       | The OpenCode copy of the same skill. The runner config points OpenCode at both folders.                                                                                     |
| `.github/ISSUE_TEMPLATE/foundry.yml` | No       | Issue form that adds the `foundry` label and the Goal / Acceptance criteria / Constraints / Out of scope sections.                                                          |

Onboarding jobs always use the built-in onboarding playbook; repo playbooks and skills only affect ticket
jobs. A ticket job gets a playbook from `.foundry/playbook.md` when its `playbook` is `default`, otherwise
from `.foundry/playbook.<name>.md`. Harness notes are appended in addition to the chosen playbook, and every
file in `.foundry/skills/` is appended after that.

### Skills

Skills are agent instructions the harness loads natively (a `SKILL.md` with `name` and
`description` frontmatter). Foundry ships three skills: `merge-risk`, which the automatic PR reviewer
uses to report a low/medium/high merge risk; `show-me`, which explains a topic visually with concise
diagrams, code-shape sketches or a focused HTML artifact; and `resolve-merge-conflicts`, which agents
use to inspect and resolve a conflicted merge, rebase or cherry-pick without loading whole files into
context. Onboarding copies every built-in skill into `.claude/skills/<name>/SKILL.md` and
`.opencode/skills/<name>/SKILL.md`, so the recipe PR carries them. A session loads skills from those
folders: Claude Code enables exactly the skill names found under the repo's `.claude/skills` (never
the machine's user or plugin skills), and OpenCode is pointed at both paths. `show-me` keeps its
upstream `disable-model-invocation: true`, so it is invoked by a person (`/show-me`) rather than
chosen automatically by the model.

After onboarding, install or update them from the repository root:

```bash
foundry skills list
foundry skills install              # every built-in skill
foundry skills install merge-risk   # just one
```

`foundry skills install` overwrites the files, so re-running it is the update path. Commit the
result.

The issue form produces the body Foundry reads for ticket structure: the prompt uses the `Goal` and
`Acceptance criteria` headings, and a missing `Acceptance criteria` section tells triage to consider asking a
question. The `labels: ["foundry"]` entry is what makes the issue eligible for a job once the repo is
onboarded.

## Variables in recipe commands

Every job runs with these environment variables:

| Variable           | Value                                        |
| ------------------ | -------------------------------------------- |
| `FOUNDRY_JOB_ID`   | The job's id.                                |
| `FOUNDRY_PORT`     | First port in the job's block of 10.         |
| `FOUNDRY_PORT_END` | Last port in the block (`FOUNDRY_PORT + 9`). |
| `FOUNDRY_BRANCH`   | The branch the job is working on.            |

`expandRecipeVars` (`packages/shared/src/recipe.ts`) substitutes `$FOUNDRY_...` and `${FOUNDRY_...}` in a
value. The runner applies it to `dev_server.run` before starting the server. For a ticket job, `install` and
`checks[].run` also run through the platform shell (`sh -c`, or PowerShell on Windows) with the same
environment, so the shell expands those variables there too. `warm` only runs during a readiness pass, which
sets just the proxy variables and `FOUNDRY_TEST_DATABASE_URL`, so per-job values are not available there.
`services.postgres.database` is a name, not a command, and is not expanded.

## `recipe.yaml`

### Top-level fields

| Field         | Type                                 | Default      | What the runner does with it                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `install`     | string                               | none         | Runs once when a ticket job starts (skipped on an in-place resume) with a 30-minute timeout. Also runs during onboarding and during a readiness pass, before the checks. A non-zero exit fails the job.                                                            |
| `checks`      | array of check objects               | `[]`         | The verification commands. The agent runs them with the `run_checks` MCP tool; on `stage(done)` the runner runs them again against the final tree (reusing the last run when the tree is unchanged). Each result is recorded as `check` evidence. See below.       |
| `dev_server`  | object                               | none         | Used only when a diff touches `ui_paths` and the agent did not attach a screenshot. See below.                                                                                                                                                                     |
| `services`    | object                               | `{}`         | Optional per-job services. See below.                                                                                                                                                                                                                              |
| `env_file`    | string                               | none         | Copies this path to `.env` in the job worktree if the worktree does not already have a `.env`. Copy errors are ignored.                                                                                                                                            |
| `system_deps` | array of strings                     | `[]`         | Readiness only: each entry is a binary that must be on `PATH`, optionally with a minimum version (`node>=22`). With a `>=` minimum the runner runs `<bin> --version` and reports itself not ready when the dependency is missing or too old. Nothing is installed. |
| `warm`        | array of strings                     | `[]`         | Commands run during a readiness pass, before `install` and the checks. They run when a runner first proves a recipe and again after a restart or a recipe change, not for every job. No per-step timeout; the 20-minute readiness deadline bounds them.            |
| `os`          | array of `macos`, `linux`, `windows` | absent (any) | Readiness only: a runner whose OS is not listed reports not ready for the repo.                                                                                                                                                                                    |
| `ui_paths`    | array of globs                       | see below    | A changed file matching any glob counts as a UI change. If the diff is a UI change, a passing screenshot is required before the PR is opened and before the gate can auto-merge. Set `[]` to disable UI-change detection.                                          |

If `recipe.yaml` is missing or fails validation, a ticket job fails at start; a readiness pass reports the
repo as not ready.

### `checks[]`

| Field         | Type              | Default  | What the runner does with it                                                                          |
| ------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `name`        | string, non-empty | required | Evidence name. The gate requires passing `check` evidence for every check name.                       |
| `run`         | string, non-empty | required | Command to run in the worktree through the platform shell with the job environment.                   |
| `timeout_sec` | positive integer  | `900`    | Per-check timeout. On expiry the runner kills the whole process tree and records the check as failed. |

A failed check sends the job back to **implementing** and retries, up to `max_verify_loops`. When retries are
exhausted the job fails. An empty `checks` list fails onboarding ("The recipe defines no checks") and blocks
auto-merge, because nothing was verified.

### `dev_server`

| Field         | Type             | Default  | What the runner does with it                                                                                       |
| ------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `run`         | string           | required | Started in the worktree after `expandRecipeVars` substitutes the `FOUNDRY_*` variables.                            |
| `ready_path`  | string           | `/`      | Appended to `http://127.0.0.1:$FOUNDRY_PORT`; a missing leading `/` is added. The runner polls this URL for a 2xx. |
| `timeout_sec` | positive integer | `120`    | How long to wait for the URL before failing the job.                                                               |

The server is started only while capturing a UI screenshot, then stopped. If a UI change has no `dev_server`
and the agent did not attach a screenshot, the job fails. Screenshots are taken with
`npx playwright screenshot`, so Playwright must be available (put it in `warm` or `system_deps`).

### `services`

| Field               | Type   | Default | What the runner does with it                                                                                                                                                                                                                                                                                   |
| ------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres.database` | string | none    | Declares that ticket jobs need Postgres. The runner creates `foundry_<jobid>_<database>` on its `FOUNDRY_POSTGRES_URL` admin URL and exposes `DATABASE_URL` and `FOUNDRY_DATABASE_URL`. The database is dropped when the job ends. Readiness reports not ready when the runner has no Postgres URL configured. |

The value is a name suffix, sanitized to word characters and truncated to 63 characters; it is not a command
and is not expanded. A readiness pass also exports the runner's Postgres as `FOUNDRY_TEST_DATABASE_URL`.

### Default `ui_paths`

`ui_paths` replaces the default list when set:

```
**/*.tsx
**/*.jsx
**/*.vue
**/*.svelte
**/*.css
**/*.scss
**/*.html
**/components/**
**/pages/**
**/app/**/page.*
```

### Minimal `recipe.yaml`

```yaml
# .foundry/recipe.yaml — fields shown use their schema defaults unless noted.
install: pnpm install --frozen-lockfile

checks:
  - name: test
    run: pnpm test
    # timeout_sec: 900

dev_server:
  run: pnpm dev --port $FOUNDRY_PORT
  # ready_path: /
  # timeout_sec: 120

# Optional:
# services:
#   postgres:
#     database: app
# env_file: .env.example
# system_deps: [node>=22]
# warm:
#   - pnpm install --frozen-lockfile
# os: [macos, linux]
# ui_paths: ["apps/web/src/**"]
```

## `policy.yaml`

If `policy.yaml` is missing or fails schema validation, the runner and the control plane use
`DEFAULT_POLICY`, so a bad value silently restores every default below (an unknown key is simply ignored). A
risk rule with neither `paths` nor `diff_regex` is invalid and invalidates the whole file.

### Gate and budget fields

| Field                          | Type                            | Default                            | What it does                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge`                        | `off` \| `merge_when_confident` | `off`                              | Auto-merge is considered only in `merge_when_confident`. The panel's repo setting wins when it enables merging; otherwise this value decides. Onboarding jobs never auto-merge.                                                                                                                                                                                                                   |
| `require_ci_green`             | boolean                         | `true`                             | When true, a pending CI run makes the gate wait, and a failed run blocks auto-merge. When false, CI is ignored.                                                                                                                                                                                                                                                                                   |
| `require_ai_review_clean`      | boolean                         | `false`                            | When true, the gate waits until a review from one of `ai_review_bots` exists, and blocks if the latest such review is `CHANGES_REQUESTED`.                                                                                                                                                                                                                                                        |
| `ai_review_bots`               | array of GitHub logins          | `["cursor[bot]"]`                  | Reviews from these logins count as the AI review.                                                                                                                                                                                                                                                                                                                                                 |
| `auto_pr_review`               | boolean                         | `false`                            | After the PR's CI checks finish, run the reviewer again on the pushed head with the failed check details and post the result to the PR. Blocking findings loop the job back to implementing; a passing review leaves comments and still hands the PR to a human — never auto-merge. If the repo has registered no checks two minutes after entering `pr_ci`, the worker starts the review anyway. |
| `max_verify_loops`             | integer ≥ 0                     | `3`                                | How many times a failed verification may send the job back to implementing. `0` means fail immediately.                                                                                                                                                                                                                                                                                           |
| `max_review_loops`             | integer ≥ 0                     | `2`                                | How many times the reviewer may send a change back to implementing (both the pre-verify review and the automatic PR review). Past the budget the job stops looping and goes to a human.                                                                                                                                                                                                           |
| `max_cost_per_job_usd`         | positive number                 | `10`                               | Cost budget. The runner stops the job when cumulative cost exceeds it; the gate also fails auto-merge over it. A per-job override wins.                                                                                                                                                                                                                                                           |
| `max_diff_lines_for_automerge` | positive integer                | `400`                              | A larger diff blocks auto-merge and waits for a human.                                                                                                                                                                                                                                                                                                                                            |
| `max_job_minutes`              | positive integer                | `60`                               | Wall-clock limit. The runner stops the job when it exceeds it. A per-job override wins.                                                                                                                                                                                                                                                                                                           |
| `permissions.deny_commands`    | array of strings                | `["git push", "rm -rf /", "sudo"]` | Shell commands the harness may not run. Matching is by prefix, including after `&&` or `;`.                                                                                                                                                                                                                                                                                                       |
| `permissions.allow_web_fetch`  | boolean                         | `true`                             | Passed to the harness as its web-fetch permission.                                                                                                                                                                                                                                                                                                                                                |
| `risk_rules`                   | array                           | `[]`                               | Path or regex rules that block auto-merge and route reviewers. See below.                                                                                                                                                                                                                                                                                                                         |

`permissions` is translated by `permissionsFromPolicy` (`packages/harness-core/src/types.ts`) into the
harness permission policy. The budgets are resolved with `effectiveMaxJobMinutes` and
`effectiveMaxCostUsd`: a job-level override wins over the policy value.

### `risk_rules[]`

| Field        | Type              | Default  | What it does                                                                                                             |
| ------------ | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `name`       | string, non-empty | required | Shown as `Risk rule hit: <name> (N files)` when the rule blocks auto-merge.                                              |
| `paths`      | array of globs    | none     | Matches changed file paths with picomatch.                                                                               |
| `diff_regex` | string (regex)    | none     | Tested against the added lines of each changed file.                                                                     |
| `reviewers`  | array of handles  | `[]`     | GitHub users or teams (`@user`, `@org/team`; the `@` is optional). Requested on the PR when this rule blocks auto-merge. |

A rule matches when any changed path matches `paths` **or** any added line matches `diff_regex`. Every matched
rule is listed on the job, blocks auto-merge, and contributes its `reviewers` to the routed review request. A
rule needs non-empty `paths` or a `diff_regex`.

### Minimal `policy.yaml`

The values below are all defaults:

```yaml
# .foundry/policy.yaml
merge: off
require_ci_green: true
require_ai_review_clean: false
ai_review_bots: ["cursor[bot]"]
auto_pr_review: false
max_verify_loops: 3
max_review_loops: 2
max_cost_per_job_usd: 10
max_diff_lines_for_automerge: 400
max_job_minutes: 60

permissions:
  deny_commands: ["git push", "rm -rf /", "sudo"]
  allow_web_fetch: true

risk_rules: []
```

A rule that blocks auto-merge for database changes and asks a team to review:

```yaml
risk_rules:
  - name: database
    paths: ["packages/db/migrations/**", "packages/db/src/**"]
    reviewers: ["@acme/backend-leads"]
```

## Other files

`playbook.md`, `playbook.<name>.md` and `playbook.<harness>.md` are markdown, not YAML. They replace or add to
the system prompt; they do not have schema fields.

```markdown
<!-- .foundry/playbook.md -->
# Repo playbook

Follow the default stages, plus:

- Use `pnpm`, never `npm`.
- Add tests in the package you changed.
```

```markdown
<!-- .foundry/playbook.bugfix.md -->
# Bugfix playbook

Start triage by reproducing the bug with a failing test.
```

```markdown
<!-- .foundry/playbook.claude-code.md -->
# Notes for claude-code

This repo's tests need `FOUNDRY_TEST_DATABASE_URL`.
```

```markdown
<!-- .foundry/skills/architecture.md -->
# Architecture

`apps/web` is the control plane. Business rules live in `packages/control`, not in route handlers.
```

```yaml
# .github/ISSUE_TEMPLATE/foundry.yml — minimal form; the shipped one also has Constraints and Out of scope.
name: Foundry ticket
description: Describe work for Foundry to pick up.
labels: ["foundry"]
body:
  - type: textarea
    id: goal
    attributes:
      label: Goal
      description: What should be true when this is done?
    validations:
      required: true
  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance criteria
      description: Concrete, checkable outcomes.
    validations:
      required: true
```
