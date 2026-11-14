# harness-log Skill

## Overview

Built-in skill that teaches a harness to read a job's `.harness.log` and reconstruct the conversation. The executable part lives in `scripts/`; the `SKILL.md` is the playbook text installed into the worktree.

## Subdirectories & Boundaries

- [scripts](./scripts/EGM.md): the `extract-conversation.mjs` CLI and its contract.
- [SKILL.md](./SKILL.md): the skill instructions copied into the job worktree.

## Interface

- The skill is registered in `@foundry/playbooks` via `BUILTIN_SKILL_ASSETS` and `skillFiles` `[../../index.ts]`.
- Invoking it runs the CLI in [scripts](./scripts/EGM.md).

## Invariants

- The asset list includes both `SKILL.md` and every file under `scripts/`; a file not listed is not copied `[../../index.ts:BUILTIN_SKILL_ASSETS]`.
- The skill writes into both the repo skills directory and the harness skills directory via `skillFiles` `[../../index.ts:skillFiles]`.

## Side Effects

- None at import time; the CLI reads log files only when invoked.

## Verification

- Run: `pnpm test`
