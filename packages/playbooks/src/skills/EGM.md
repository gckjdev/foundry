# @foundry/playbooks — Skills

## Overview

Built-in skills shipped with Foundry. Each skill is a directory with a `SKILL.md`; `harness-log` additionally has executable scripts. `@foundry/playbooks` copies these into a job worktree when a playbook or recipe requests them.

## Subdirectories & Boundaries

- [harness-log](./harness-log/EGM.md): reconstruct a job's conversation from `.harness.log`; includes [scripts](./harness-log/scripts/EGM.md).
- [code-review](./code-review/SKILL.md): read-only review checklist.
- [merge-risk](./merge-risk/SKILL.md): classify a diff by merge risk.
- [resolve-merge-conflicts](./resolve-merge-conflicts/SKILL.md): conflict resolution procedure.
- [show-me](./show-me/SKILL.md): render UI proof instructions.

## Interface

- Skill names are collected by `readSkillNames` in `@foundry/harness-core` and resolved by `resolveSkills`.
- Only `harness-log` has code; the other skills are pure Markdown and are linked directly rather than given their own contract.

## Invariants

- A skill directory must contain `SKILL.md`; `readSkillNames` prefers the frontmatter `name` over the directory name `[../../../harness-core/src/skills.ts:readSkillNames]`.
- `skillFiles` writes each skill into both the repo skills directory and the harness skills directory `[../index.ts:skillFiles]`.
- Requesting an unknown skill throws `[../index.ts:skillFiles]`.
- A built-in review body is used only when the corresponding skill is not installed `[../index.ts:assembleReviewPrompt]`.

## Side Effects

- None at import time; files are materialized only when `skillFiles` runs.

## Verification

- Run: `pnpm test`
