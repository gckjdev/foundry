# @foundry/harness-claude-code — Source

## Overview

Claude Code harness adapter backed by the Claude Code Agent SDK. It starts a session in the job worktree with project-only settings, restricts tools according to policy, normalizes SDK messages into `HarnessEvent`s and tracks per-session cost.

## Interface

- `[index.ts]` — `ClaudeCodeAdapter` (implements `HarnessAdapter`) and re-exports.
- `[adapter.ts]` — `ClaudeCodeAdapter`: `start`, `resume`, `info`; helpers `disallowedTools`, `canUseTool`, `userSettingsEnv`, `repoSkillNames`, `claudeExecutable`.
- `[normalize.ts]` — `normalizeClaudeMessage`, `summarizeToolInput`: map SDK messages to Foundry events.

## Invariants

- Sessions load **project** settings only: `settingSources: ["project"]` `[adapter.ts:start]`.
- Skills are passed explicitly from `repoSkillNames`; the harness never inherits personal `~/.claude` hooks `[adapter.ts:repoSkillNames]`.
- `ReportFindings` is always disallowed; edit tools are removed when `allowEdits === false` `[adapter.ts:disallowedTools][adapter.ts:canUseTool]`.
- Cost is reported as a delta per session, not the SDK's cumulative total `[adapter.ts]`.
- `abort` transitions the session to `stopped` and resolves `id` once `[adapter.ts:abort]`.

## Side Effects

- Spawns `claude --version` / `claude --security` via `spawnSync` for capability checks `[adapter.ts:claudeExecutable]`.
- Reads `~/.claude/settings.json` when mirroring user-settings env `[adapter.ts:userSettingsEnv]`.
- Runs the Agent SDK child process (network to the model provider through the configured base URL/proxy).
- Appends to the job harness log via `@foundry/harness-core`.

## Verification

- Run: `pnpm test`
