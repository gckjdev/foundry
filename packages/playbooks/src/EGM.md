# @foundry/playbooks — Source

## Overview

Prompt assembly for job harnesses. Builds the system prompt for each playbook kind, renders user inputs, produces review prompts and resume/nudge messages, and exposes the built-in playbooks and skills. Pure string assembly: no model calls and no I/O.

## Subdirectories & Boundaries

- [skills](./skills/EGM.md): built-in skill directories, including executable [harness-log scripts](./skills/harness-log/scripts/EGM.md).
- Playbook bodies (Markdown, linked directly): [default](./playbooks/default.md), [bugfix](./playbooks/bugfix.md), [feature](./playbooks/feature.md), [onboarding](./playbooks/onboarding.md), [reviewer](./playbooks/reviewer.md).

## Interface

- `[index.ts:BUILTIN_PLAYBOOKS]` — map of built-in playbook ids to rendered prompt bodies.
- `[index.ts:basePlaybook]`, `[index.ts:assemblePrompt]`, `[index.ts:assembleReviewPrompt]` — compose the harness system prompt.
- `[index.ts:renderInputs]`, `[index.ts:resumeMessage]`, `[index.ts:NUDGE_MESSAGE]`, `[index.ts:verifyFailedMessage]` — user-turn and resume text.
- `[index.ts:skillFiles]`, `[index.ts:skillBody]`, `[index.ts:BUILTIN_SKILLS]`, `[index.ts:PLAYBOOK_SKILLS]`, `[index.ts:SKILL_DIRS]`, `[index.ts:BUILTIN_SKILL_ASSETS]` — skill discovery and materialization.
- `[md.d.ts]` — declares `*.md` and `*.mjs` as text imports for Vitest.

## Invariants

- `bugfix` and `feature` are `default` plus an appendix `[index.ts:BUILTIN_PLAYBOOKS]`.
- Onboarding always uses the onboarding playbook regardless of repo configuration `[index.ts:basePlaybook]`.
- A named repo playbook wins over the built-in of the same id `[index.ts:basePlaybook]`.
- `skillFiles` writes `SKILL.md` and every listed asset into both skill directories; an unknown skill throws `[index.ts:skillFiles]`.
- A built-in review body is emitted only when the skill is not installed `[index.ts:assembleReviewPrompt]`.
- All exports are pure functions of their arguments; imports have no side effects.

## Side Effects

- None. Functions return strings and file descriptors; the caller writes them to disk.

## Verification

- Run: `pnpm test`
