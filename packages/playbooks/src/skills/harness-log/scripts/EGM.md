# harness-log — Scripts

## Overview

Node CLI that extracts a readable conversation from a job's harness log so a harness (or a human) can inspect what a previous session did without replaying raw JSON records.

## Interface

- `[extract-conversation.mjs]` — command-line entry. Flags: `--session <uuid>` (required), `--max-text <n>` (default 600), `--thinking`, `--tool-results`, `--json`.

## Invariants

- A missing `--session` exits with code 2; a missing log file exits with code 1 `[extract-conversation.mjs]`.
- The session UUID resolves to `~/.foundry/jobs/<id>.harness.log` `[extract-conversation.mjs]`.
- Output blocks are delimited by a `===== ... =====` marker line `[extract-conversation.mjs]`.
- A session is classified as `review` or `work` and annotated accordingly `[extract-conversation.mjs]`.
- Text is clipped to `--max-text` characters unless the full form is requested.

## Side Effects

- Reads the harness log file from disk and prints the formatted transcript to stdout.

## Verification

- Run: `pnpm test`
