# Handoff brief: Skill installation/sync for Repo in Repos UI page

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-12T12:12:46.257Z

## Plan

## Plan: Install / sync skills from the Repos page

Goal: an admin can click **Install / sync skills** on a repo card; Foundry opens (or refreshes) a PR that writes Foundry's built-in playbook skills into `.claude/skills/<name>/SKILL.md` and `.opencode/skills/<name>/SKILL.md`.

1. **Share the skill file list** (`packages/playbooks/src/index.ts`)
   - Add `SKILL_DIRS` and a pure `skillFiles(names?)` returning `{ name, path, content }[]` for both harness folders, validating unknown names (same error text as today).
   - Keep `BUILTIN_SKILLS` / `PLAYBOOK_SKILLS` as the source of content.

2. **Reuse it in the runner** (`apps/runner/src/skills.ts`)
   - `installSkills` writes the files from `skillFiles`; re-export `SKILL_DIRS` so existing imports/tests still work.

3. **GitHub client writes** (`packages/github/src/{types,octokit,fake}.ts`)
   - `createBranch(ref, branch, fromSha, force?)` (create ref, or force-update a stale ref).
   - `putFile(ref, { path, content, message, branch })` using the Contents API, updating when the file already exists.

4. **Control action** (`packages/control/src/skills.ts`, exported from `index.ts`)
   - `syncRepoSKills(ctx, repoId)`: build files with `skillFiles()`, reuse the open `foundry/skills` PR when present, otherwise reset/create the branch from the default branch and open a PR titled "Install Foundry skills" with a short body.
   - Add `@foundry/playbooks` to `packages/control` deps and to web `transpilePackages`.

5. **Panel wiring** (`apps/web/src/app/actions.ts`, `apps/web/src/app/(panel)/repos/page.tsx`)
   - Admin-only server action; redirect to `/repos?skills=<pr url>` on success or `?skillsError=<msg>` on failure (URL validated before rendering).
   - Add the button to each repo card and show the success/error notices.

6. **Tests**
   - `packages/playbooks/src/playbooks.test.ts`: `skillFiles` paths for both harnesses, content, unknown-name rejection.
   - `packages/github/src/octokit.mock.test.ts`: create/force-update ref and create/update content via `MockAgent`.
   - `packages/control/src/control.test.ts`: fake-GitHub test that a sync writes both files, opens one PR, and reuses it (DB-gated).

7. **Verify**: biome, typecheck, vitest; then run the dev server and screenshot the Repos card with the new control.


## Findings

- triage: Ticket is clear: add a per-repo "install/sync skills" action on the Repos panel page that opens a PR adding/updating .claude/skills and .opencode/skills from Foundry's built-in playbook skills. Investigating how control can read skill contents and write a branch/PR through the GitHub client.
- investigating: Investigated the CLI install path, panel actions, GitHub client/fake, and control tests. Plan recorded: share skill-file generation in @foundry/playbooks, add Contents-API writes to the GitHub client, add a control sync function that opens/reuses a skills PR, and wire an admin button plus notices into the Repos page.
- implementing: Implemented skills sync from the Repos page: shared skill-file generation in @foundry/playbooks, GitHub client createBranch/putFile (Contents API), a control syncRepoSKills that opens or reuses a foundry/skills PR for .claude/skills and .opencode/skills, and an admin-only Install / sync skills button with success/error notices and a verified screenshot. Added tests for both harness paths, PR reuse/reset, and the Octokit HTTP calls; lint, typecheck, web build, and the full suite (307 tests with a temp Postgres) pass.
- review: Reviewed the full diff against `origin/main` (17 files: shared skill-file generation, GitHub ref/contents writes, a control action, the Repos page + server action, tests and two screenshots).

**Code quality** — the core design is sound and matches the ticket: `skillFiles()` in `@foundry/playbooks` is now the single source of the paths/content for both harnesses, `installSkills` keeps its behaviour (same error text, same installed paths, now POSIX), and `syncRepoSKills` follows the existing `openPullRequest` pattern (`findPullRequest` → reuse when `state === "open"`, otherwise create). The PR-reuse and branch-reset paths are covered by the new DB-gated test, and the fake's `findPullRequest` ordering fix now matches GitHub's newest-first listing. Acceptance criterion ("install/sync playbook skills, both claude and opencode") is met and directly asserted in `packages/control/src/control.test.ts:1014` and `packages/playbooks/src/playbooks.test.ts:116`. Findings below are all non-blocking: an idempotency gap when nothing changed, and two test-fidelity gaps around the Contents API update path.

**UI design** — checked against `DESIGN.md`: the new control is a secondary button (only the non-onboarded card keeps its single primary "Onboard repo"), the notice reuses the existing `.notice`/`data-tone="bad"` pattern, no invented colors/tokens/spacing, no nested forms, and the layout matches neighbouring cards in both screenshots. The success link is scheme-validated before rendering. One non-blocking UX gap: the open skills PR is not shown persistently on the card.

**Security** — no blocking issues: the action is admin-gated via `requireAdmin` and the repo lookup is team-scoped (`teamRepo`), file paths/messages come from constants rather than user input, no secrets or tokens are logged, the redirect target is a URL-encoded PR URL validated against `^https?://` before becoming an `href`, and the error text is React-escaped. No new external dependencies (only a workspace link).

I could not execute the test suite here (this review worktree has no installed dependencies), so I relied on static analysis plus the implementer's reported `run_checks`/build results and the attached screenshots.
- reviewing: Reviewer approved. Running the repository recipe checks in this worktree and attaching the UI screenshots as evidence.

## Checks

_not run_

## Questions and answers

- Q: From the Repos page, how should "Install / sync skills" write the built-in skills into the repo? (This decides whether the change goes through review.)
  A: Open a PR with the added/updated .claude/skills and .opencode/skills files (reviewable, consistent with onboarding). Recommended.

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "795fa3fa-4b43-4f49-bcf6-c6b722b54a83",
  "title": "Skill installation/sync for Repo in Repos UI page",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "3d025062-3987-4080-9472-e526d06d9387",
  "plan": "## Plan: Install / sync skills from the Repos page\n\nGoal: an admin can click **Install / sync skills** on a repo card; Foundry opens (or refreshes) a PR that writes Foundry's built-in playbook skills into `.claude/skills/<name>/SKILL.md` and `.opencode/skills/<name>/SKILL.md`.\n\n1. **Share the skill file list** (`packages/playbooks/src/index.ts`)\n   - Add `SKILL_DIRS` and a pure `skillFiles(names?)` returning `{ name, path, content }[]` for both harness folders, validating unknown names (same error text as today).\n   - Keep `BUILTIN_SKILLS` / `PLAYBOOK_SKILLS` as the source of content.\n\n2. **Reuse it in the runner** (`apps/runner/src/skills.ts`)\n   - `installSkills` writes the files from `skillFiles`; re-export `SKILL_DIRS` so existing imports/tests still work.\n\n3. **GitHub client writes** (`packages/github/src/{types,octokit,fake}.ts`)\n   - `createBranch(ref, branch, fromSha, force?)` (create ref, or force-update a stale ref).\n   - `putFile(ref, { path, content, message, branch })` using the Contents API, updating when the file already exists.\n\n4. **Control action** (`packages/control/src/skills.ts`, exported from `index.ts`)\n   - `syncRepoSKills(ctx, repoId)`: build files with `skillFiles()`, reuse the open `foundry/skills` PR when present, otherwise reset/create the branch from the default branch and open a PR titled \"Install Foundry skills\" with a short body.\n   - Add `@foundry/playbooks` to `packages/control` deps and to web `transpilePackages`.\n\n5. **Panel wiring** (`apps/web/src/app/actions.ts`, `apps/web/src/app/(panel)/repos/page.tsx`)\n   - Admin-only server action; redirect to `/repos?skills=<pr url>` on success or `?skillsError=<msg>` on failure (URL validated before rendering).\n   - Add the button to each repo card and show the success/error notices.\n\n6. **Tests**\n   - `packages/playbooks/src/playbooks.test.ts`: `skillFiles` paths for both harnesses, content, unknown-name rejection.\n   - `packages/github/src/octokit.mock.test.ts`: create/force-update ref and create/update content via `MockAgent`.\n   - `packages/control/src/control.test.ts`: fake-GitHub test that a sync writes both files, opens one PR, and reuses it (DB-gated).\n\n7. **Verify**: biome, typecheck, vitest; then run the dev server and screenshot the Repos card with the new control.\n",
  "findings": [
    "triage: Ticket is clear: add a per-repo \"install/sync skills\" action on the Repos panel page that opens a PR adding/updating .claude/skills and .opencode/skills from Foundry's built-in playbook skills. Investigating how control can read skill contents and write a branch/PR through the GitHub client.",
    "investigating: Investigated the CLI install path, panel actions, GitHub client/fake, and control tests. Plan recorded: share skill-file generation in @foundry/playbooks, add Contents-API writes to the GitHub client, add a control sync function that opens/reuses a skills PR, and wire an admin button plus notices into the Repos page.",
    "implementing: Implemented skills sync from the Repos page: shared skill-file generation in @foundry/playbooks, GitHub client createBranch/putFile (Contents API), a control syncRepoSKills that opens or reuses a foundry/skills PR for .claude/skills and .opencode/skills, and an admin-only Install / sync skills button with success/error notices and a verified screenshot. Added tests for both harness paths, PR reuse/reset, and the Octokit HTTP calls; lint, typecheck, web build, and the full suite (307 tests with a temp Postgres) pass.",
    "review: Reviewed the full diff against `origin/main` (17 files: shared skill-file generation, GitHub ref/contents writes, a control action, the Repos page + server action, tests and two screenshots).\n\n**Code quality** — the core design is sound and matches the ticket: `skillFiles()` in `@foundry/playbooks` is now the single source of the paths/content for both harnesses, `installSkills` keeps its behaviour (same error text, same installed paths, now POSIX), and `syncRepoSKills` follows the existing `openPullRequest` pattern (`findPullRequest` → reuse when `state === \"open\"`, otherwise create). The PR-reuse and branch-reset paths are covered by the new DB-gated test, and the fake's `findPullRequest` ordering fix now matches GitHub's newest-first listing. Acceptance criterion (\"install/sync playbook skills, both claude and opencode\") is met and directly asserted in `packages/control/src/control.test.ts:1014` and `packages/playbooks/src/playbooks.test.ts:116`. Findings below are all non-blocking: an idempotency gap when nothing changed, and two test-fidelity gaps around the Contents API update path.\n\n**UI design** — checked against `DESIGN.md`: the new control is a secondary button (only the non-onboarded card keeps its single primary \"Onboard repo\"), the notice reuses the existing `.notice`/`data-tone=\"bad\"` pattern, no invented colors/tokens/spacing, no nested forms, and the layout matches neighbouring cards in both screenshots. The success link is scheme-validated before rendering. One non-blocking UX gap: the open skills PR is not shown persistently on the card.\n\n**Security** — no blocking issues: the action is admin-gated via `requireAdmin` and the repo lookup is team-scoped (`teamRepo`), file paths/messages come from constants rather than user input, no secrets or tokens are logged, the redirect target is a URL-encoded PR URL validated against `^https?://` before becoming an `href`, and the error text is React-escaped. No new external dependencies (only a workspace link).\n\nI could not execute the test suite here (this review worktree has no installed dependencies), so I relied on static analysis plus the implementer's reported `run_checks`/build results and the attached screenshots.",
    "reviewing: Reviewer approved. Running the repository recipe checks in this worktree and attaching the UI screenshots as evidence."
  ],
  "checks": [],
  "qa": [
    {
      "question": "From the Repos page, how should \"Install / sync skills\" write the built-in skills into the repo? (This decides whether the change goes through review.)",
      "answer": "Open a PR with the added/updated .claude/skills and .opencode/skills files (reviewable, consistent with onboarding). Recommended."
    }
  ],
  "uncertainties": [],
  "updatedAt": "2026-11-12T12:12:46.257Z"
}
```
