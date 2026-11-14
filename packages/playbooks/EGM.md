# @foundry/playbooks

## Overview

Built-in playbooks and skills plus the prompt assembly used to start and resume harness sessions. Package boundary: name `@foundry/playbooks`, ESM, exports TypeScript source `[package.json:exports]`. Single entry point `.` → `./src/index.ts` `[package.json:exports]`. Depends only on `@foundry/shared` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): prompt assembly, playbook bodies, skill materialization.
- [src/skills](./src/skills/EGM.md): built-in skills, including executable [harness-log scripts](./src/skills/harness-log/scripts/EGM.md).

## Interface

- `.` exports `BUILTIN_PLAYBOOKS`, `basePlaybook`, `assemblePrompt`, `assembleReviewPrompt`, `renderInputs`, `resumeMessage`, `NUDGE_MESSAGE`, `verifyFailedMessage`, `skillFiles`, `skillBody`, `BUILTIN_SKILLS`, `PLAYBOOK_SKILLS`, `SKILL_DIRS`, `BUILTIN_SKILL_ASSETS` `[src/index.ts]`.

## Invariants

- Playbook and skill functions are pure string/file-descriptor builders; nothing writes to disk `[src/index.ts]`.
- Onboarding always uses the onboarding playbook `[src/index.ts:basePlaybook]`.

## Side Effects

- None at import time; the caller writes the returned file descriptors.

## Verification

- Run: `pnpm test`
