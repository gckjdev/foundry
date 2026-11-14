---

name: harness-log
description: Use when needing to read or reconstruct a coding agent's conversation — its text messages, tool calls and thinking — from a harness log (*.harness.log) or Claude Code SDK stream-json transcript file.
---

# Harness Log

## Overview

An agent harness (a Foundry runner job, or a raw Claude Code SDK session) writes its full transcript — system prompt, assistant text, tool calls, thinking — to a log file. This skill reconstructs that conversation into a readable timeline, so you can see what the agent did without reading the raw JSON.

## When to Use

- "What did the agent actually do here?"
- "What command did it run / what file did it edit?"
- Reconstructing the last steps before a failure or a stall.
- Checking whether a `Skill(...)` was actually invoked, vs. only mentioned in the prompt.
- Comparing sessions in one log (e.g. an implementation pass vs. a review pass).

## Quick Reference

Run the bundled script:

```bash
node scripts/harness-log/extract-conversation.mjs <file|jobId> [flags]
```

| Flag             | Effect                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `--session <v>`  | Restrict to a session by tag (`review`/`work`), a 1-based index, or a worktree-substring |
| `--thinking`     | Include `thinking` blocks (default: hidden)                                              |
| `--tool-results` | Include tool results, truncated (default: hidden)                                        |
| `--max-text N`   | Truncate long text at N chars (default 600)                                              |
| `--json`         | Emit raw JSON instead of the readable form                                               |

A job UUID resolves to `~/.foundry/jobs/<id>.harness.log`; otherwise pass a file path.

Output: a header, then one block per session — `── Session N · <tag> · <HH:MM:SS> · <worktree>` — followed by `[system prompt]`, `[assistant]`, `[tool_call]`, `[thinking]`, `[user]` lines in order.

## Log Format (reference)

The file is a stream of sections, each a pretty-printed JSON object after a marker:

```
===== 2026-11-13T13:12:42.160Z REQUEST query =====   ← session boundary (has systemPrompt + prompt)
===== 2026-11-13T13:12:45.611Z CLAUDE message =====  ← one SDK message (system/assistant/user)
```

Key fields:

- A `REQUEST query` section carries `systemPrompt` + `prompt` and starts a new session. Its tag is `review` when the prompt is a review prompt, else `work`. The `systemPrompt` becomes the `[system prompt]` line and the `prompt` becomes the `[user]` line.
- `CLAUDE message` → `type: assistant` → `message.content[]`:
  - `{type: "text", text}` — the agent's message → `[assistant]`
  - `{type: "tool_use", name, input}` — a tool call (summarized) → `[tool_call]`
  - `{type: "thinking", thinking}` — hidden unless `--thinking` → `[thinking]`
- `type: user` messages carry tool results → `[user]` (shown only with `--tool-results`).

## Common Tasks

- Show only a review pass: `… <file> --session review`
- Show only the implementation: `… <file> --session work`
- Find every tool call to a skill: `… <file> | grep 'Skill('`
- See what was edited: `… <file> | grep -E 'Edit|Write'`
- Reconstruct a failure: show all sessions, read the last `[tool_call]` lines.

## Common Mistakes

- Grepping the raw log for a word (e.g. `merge-risk`) also matches the system prompt and tool results — use the script and look at `[tool]` lines for actual invocations.
- Assuming one session per file: a job often logs several sessions in one file.
- Reading the whole file: it can be tens of MB; filter with `--session` first.
