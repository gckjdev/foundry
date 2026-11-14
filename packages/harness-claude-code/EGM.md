# @foundry/harness-claude-code

## Overview

Claude Code harness implementation using the Claude Code Agent SDK. Package boundary: name `@foundry/harness-claude-code`, ESM, exports TypeScript source `[package.json:exports]`. Single entry point `.` → `./src/index.ts` `[package.json:exports]`. Depends on `@foundry/harness-core`, `@foundry/os-adapters`, `@foundry/shared` and `@anthropic-ai/claude-agent-sdk` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): `ClaudeCodeAdapter`, tool gating and SDK message normalization.

## Interface

- `.` exports `ClaudeCodeAdapter` and the normalization/policy helpers `[src/index.ts]`.

## Invariants

- Sessions load project settings only (`settingSources: ["project"]`) `[src/adapter.ts:start]`.
- `ReportFindings` is always disallowed and edit tools are removed when edits are disabled `[src/adapter.ts:disallowedTools]`.

## Side Effects

- Spawns the Agent SDK child process, runs `claude` version checks and reads `~/.claude/settings.json`.

## Verification

- Run: `pnpm test`
