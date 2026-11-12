# Handoff brief: Add code review skill

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-12T14:02:05.607Z

## Plan

1. Add `packages/playbooks/src/skills/code-review/SKILL.md` containing the review methodology (code quality, UI design, security areas + how-to-review/severity rules), with `name: code-review` frontmatter.
2. Register it in `packages/playbooks/src/index.ts`: import, add to `BUILTIN_SKILLS`, add to `PLAYBOOK_SKILLS`, and embed its body in `assembleReviewPrompt` before merge-risk.
3. Rewrite `packages/playbooks/src/playbooks/reviewer.md` so it points at the code-review skill to execute the review and keeps only the Foundry-specific reporting contract (verdict/risk/findings via `foundry.review`).
4. Update tests: `packages/playbooks/src/playbooks.test.ts` (code-review skill embedded), `apps/runner/src/skills.test.ts` (both skills install with correct content), `apps/runner/src/job-runner.test.ts` (onboarding PR carries code-review).
5. Update docs that name the installed skills: `docs/foundry-dot-dir.md`, `docs/onboarding.md`, `docs/api.md` and their zh-CN mirrors.
6. Run biome, targeted vitest for playbooks/runner, then full recipe checks.

## Findings

- triage: The playbooks package ships built-in skills under packages/playbooks/src/skills/<name>/SKILL.md; merge-risk is registered in BUILTIN_SKILLS/PLAYBOOK_SKILLS, embedded into assembleReviewPrompt, and installed by onboarding. The review methodology currently lives inline in reviewer.md (the ticket's "review.md").
- investigating: Plan recorded; starting the skill file, registration, reviewer.md rewrite, tests and docs.
- implementing: Added the built-in `code-review` skill (methodology moved out of reviewer.md), registered it in BUILTIN_SKILLS/PLAYBOOK_SKILLS and embedded it in assembleReviewPrompt alongside merge-risk. Updated reviewer.md to delegate execution to the skill, plus runner/playbook tests and EN/zh docs. Full lint, typecheck and test checks pass.
- review: Checked code quality, UI design and security. The diff touches only `packages/playbooks` (skill content, registry, reviewer prompt), the runner skill installer's tests, and EN/zh docs — no UI files and no runtime/security-sensitive code, so ui_design and security have no applicable surface. Acceptance criteria are met: the new `code-review` skill is registered in BUILTIN_SKILLS and PLAYBOOK_SKILLS, embedded in `assembleReviewPrompt` with frontmatter stripped, and `reviewer.md` now delegates execution to it while keeping the `foundry.review` reporting contract. Tests were updated to prove the prompt embedding, per-skill installation into both harness folders (including that a named install does not write the other skill), and the onboarding PR contents; the docs list was updated in both languages. `pnpm exec biome check` passes on the touched TS and markdown files. I could not run vitest: this clean review worktree has no node_modules and the playbook forbids installing dependencies, so I relied on the updated unit tests plus code inspection.
- reviewing: Reviewer approved. Running the recipe checks once more on the final tree before reporting confidence.
- implementing: Merged origin/main and resolved conflicts. The code-review skill is registered in BUILTIN_SKILLS and PLAYBOOK_SKILLS (now code-review, merge-risk, resolve-merge-conflicts), embedded in assembleReviewPrompt, and reviewer.md delegates review execution to it while keeping the foundry.review reporting contract. Runner, playbook and control tests plus EN/zh docs were reconciled with main's resolve-merge-conflicts skill; lint and targeted typechecks/tests pass.
- review: Checked code quality, security and UI design. Both acceptance criteria are met: `packages/playbooks/src/skills/code-review/SKILL.md` adds the methodology, it is registered in `BUILTIN_SKILLS`/`PLAYBOOK_SKILLS`, installed by onboarding and embedded in `assembleReviewPrompt`, and `reviewer.md` now delegates review execution to it while keeping the `foundry.review` reporting contract. Tests were updated in the three places that encode the skill set (playbooks, runner skills/onboarding, control sync), and the frontmatter-stripping assertion holds against the new file. UI design does not apply: no panel, component, style or token files changed and no user-facing panel behavior moved. Security has nothing to report: no secrets, no new dependencies, no auth or data-handling changes, and the review prompt's substance is unchanged. One consistency gap is noted below (non-blocking).
- reviewing: Independent reviewer approved the merged change. Running the repo recipe checks now to prove the final tree passes.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "5e61dd3d-6e38-4667-bd29-d908d73d89d5",
  "title": "Add code review skill",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "b2d01a44-e8b9-4cdf-83c5-e07aa0c326c3",
  "plan": "1. Add `packages/playbooks/src/skills/code-review/SKILL.md` containing the review methodology (code quality, UI design, security areas + how-to-review/severity rules), with `name: code-review` frontmatter.\n2. Register it in `packages/playbooks/src/index.ts`: import, add to `BUILTIN_SKILLS`, add to `PLAYBOOK_SKILLS`, and embed its body in `assembleReviewPrompt` before merge-risk.\n3. Rewrite `packages/playbooks/src/playbooks/reviewer.md` so it points at the code-review skill to execute the review and keeps only the Foundry-specific reporting contract (verdict/risk/findings via `foundry.review`).\n4. Update tests: `packages/playbooks/src/playbooks.test.ts` (code-review skill embedded), `apps/runner/src/skills.test.ts` (both skills install with correct content), `apps/runner/src/job-runner.test.ts` (onboarding PR carries code-review).\n5. Update docs that name the installed skills: `docs/foundry-dot-dir.md`, `docs/onboarding.md`, `docs/api.md` and their zh-CN mirrors.\n6. Run biome, targeted vitest for playbooks/runner, then full recipe checks.",
  "findings": [
    "triage: The playbooks package ships built-in skills under packages/playbooks/src/skills/<name>/SKILL.md; merge-risk is registered in BUILTIN_SKILLS/PLAYBOOK_SKILLS, embedded into assembleReviewPrompt, and installed by onboarding. The review methodology currently lives inline in reviewer.md (the ticket's \"review.md\").",
    "investigating: Plan recorded; starting the skill file, registration, reviewer.md rewrite, tests and docs.",
    "implementing: Added the built-in `code-review` skill (methodology moved out of reviewer.md), registered it in BUILTIN_SKILLS/PLAYBOOK_SKILLS and embedded it in assembleReviewPrompt alongside merge-risk. Updated reviewer.md to delegate execution to the skill, plus runner/playbook tests and EN/zh docs. Full lint, typecheck and test checks pass.",
    "review: Checked code quality, UI design and security. The diff touches only `packages/playbooks` (skill content, registry, reviewer prompt), the runner skill installer's tests, and EN/zh docs — no UI files and no runtime/security-sensitive code, so ui_design and security have no applicable surface. Acceptance criteria are met: the new `code-review` skill is registered in BUILTIN_SKILLS and PLAYBOOK_SKILLS, embedded in `assembleReviewPrompt` with frontmatter stripped, and `reviewer.md` now delegates execution to it while keeping the `foundry.review` reporting contract. Tests were updated to prove the prompt embedding, per-skill installation into both harness folders (including that a named install does not write the other skill), and the onboarding PR contents; the docs list was updated in both languages. `pnpm exec biome check` passes on the touched TS and markdown files. I could not run vitest: this clean review worktree has no node_modules and the playbook forbids installing dependencies, so I relied on the updated unit tests plus code inspection.",
    "reviewing: Reviewer approved. Running the recipe checks once more on the final tree before reporting confidence.",
    "implementing: Merged origin/main and resolved conflicts. The code-review skill is registered in BUILTIN_SKILLS and PLAYBOOK_SKILLS (now code-review, merge-risk, resolve-merge-conflicts), embedded in assembleReviewPrompt, and reviewer.md delegates review execution to it while keeping the foundry.review reporting contract. Runner, playbook and control tests plus EN/zh docs were reconciled with main's resolve-merge-conflicts skill; lint and targeted typechecks/tests pass.",
    "review: Checked code quality, security and UI design. Both acceptance criteria are met: `packages/playbooks/src/skills/code-review/SKILL.md` adds the methodology, it is registered in `BUILTIN_SKILLS`/`PLAYBOOK_SKILLS`, installed by onboarding and embedded in `assembleReviewPrompt`, and `reviewer.md` now delegates review execution to it while keeping the `foundry.review` reporting contract. Tests were updated in the three places that encode the skill set (playbooks, runner skills/onboarding, control sync), and the frontmatter-stripping assertion holds against the new file. UI design does not apply: no panel, component, style or token files changed and no user-facing panel behavior moved. Security has nothing to report: no secrets, no new dependencies, no auth or data-handling changes, and the review prompt's substance is unchanged. One consistency gap is noted below (non-blocking).",
    "reviewing: Independent reviewer approved the merged change. Running the repo recipe checks now to prove the final tree passes."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-12T14:02:05.607Z"
}
```
