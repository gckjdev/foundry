# @foundry/harness-core — Source

## Overview

The harness adapter contract shared by Claude Code and OpenCode: the `HarnessAdapter`/`HarnessSession` interfaces, a scripted `FakeHarness`, an asynchronous event queue, harness-log rendering, skill discovery and permission-policy helpers. It performs no model calls itself.

## Interface

- `[types.ts]` — `HarnessAdapter`, `HarnessSession`, `StartOpts`, `ResumeOpts`, `HarnessEvent`, `PermissionPolicy`, `HarnessInfo`, `SessionResult`.
- `[index.ts]` — barrel re-exporting the modules below.
- `[fake.ts]` — `FakeHarness`: scripted events submitted through `act`, records prompts and resumes; used by the E2E job loop.
- `[queue.ts]` — `AsyncQueue`, `deferred`; turns push-style callbacks into an `AsyncIterable`.
- `[log.ts]` — `appendHarnessLog`, `clipHarnessLog` (caps at 2 MB), `harnessLogJson`; renders one JSON record per harness event.
- `[skills.ts]` — `readSkillNames` (frontmatter `name` wins), `permissionsFromPolicy`, `isDeniedCommand`, `SKILL_FRONTMATTER_RE`.

## Invariants

- A session's `events` is an `AsyncIterable` that stays open until `close`/`stop`; consumers may not assume it completes on error `[queue.ts:AsyncQueue]`.
- The `id` promise resolves once for the whole session, not per event `[types.ts:HarnessSession]`.
- Denied commands match on argv prefix, not substring `[skills.ts:isDeniedCommand]`.
- `clipHarnessLog` truncates at 2 MB and keeps the most recent records `[log.ts:clipHarnessLog]`.
- A skill's `name` comes from frontmatter when present, otherwise the directory name `[skills.ts:readSkillNames]`.

## Side Effects

- `appendHarnessLog` appends to the job's `.harness.log` file on disk.
- `FakeHarness.act` only mutates in-memory scripted state.
- No network or process I/O at import time.

## Verification

- Run: `pnpm test`
