# Handoff brief: Fix runner exit bug

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T00:24:55.772Z

## Plan

## Root cause

When a job is revoked (or paused) before the Claude Code harness reports a `session_id`, `ClaudeCodeAdapter` rejects `session.id` ("session ended before it started"). `JobRunner.track` attached `.then(...)` to that promise without a rejection handler, so the derived promise rejected unhandled and Bun exited the runner with status 1 — killing every other running job.

## Changes

1. `apps/runner/src/job-runner.ts` — attach a rejection handler to the `session.id.then(...)` chain in `track()`. A rejected id is an expected signal for awaiters (e.g. `resumeWith`), not a fatal process error.
2. `apps/runner/src/job-runner.test.ts` — regression test: a harness that is stopped before it ever reports a session id; revoking the job must finish as `revoked`, not raise an unhandled rejection (Vitest fails the run before the fix). Widen the `deps()` helper to accept any `HarnessAdapter`.

## Verification

`pnpm exec vitest run apps/runner/src/job-runner.test.ts`, then recipe checks (`run_checks`).

## Findings

- triage: Ticket has a concrete error log and one clear bug: an unhandled promise rejection kills the runner when a job is revoked before the Claude harness reports a session id. Investigating the adapter/runner session-id lifecycle now.
- investigating: Root cause: JobRunner.track chained .then() on session.id without a rejection handler; ClaudeCodeAdapter rejects that promise when a revoked/paused session ends before reporting an id, and Bun exits on the unhandled rejection. Added the handler and a regression test that reproduced the crash before the fix.
- implementing: Fix and regression test are in place; the new test reproduces the unhandled rejection before the fix and passes after it. The full job-runner suite (12 tests), biome, and the runner typecheck pass.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "592d3d80-a6d5-40f4-8e84-b2d56a43cde2",
  "title": "Fix runner exit bug",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "7dcf201f-ad44-4045-8bd6-8d5fdfa6c5fc",
  "plan": "## Root cause\n\nWhen a job is revoked (or paused) before the Claude Code harness reports a `session_id`, `ClaudeCodeAdapter` rejects `session.id` (\"session ended before it started\"). `JobRunner.track` attached `.then(...)` to that promise without a rejection handler, so the derived promise rejected unhandled and Bun exited the runner with status 1 — killing every other running job.\n\n## Changes\n\n1. `apps/runner/src/job-runner.ts` — attach a rejection handler to the `session.id.then(...)` chain in `track()`. A rejected id is an expected signal for awaiters (e.g. `resumeWith`), not a fatal process error.\n2. `apps/runner/src/job-runner.test.ts` — regression test: a harness that is stopped before it ever reports a session id; revoking the job must finish as `revoked`, not raise an unhandled rejection (Vitest fails the run before the fix). Widen the `deps()` helper to accept any `HarnessAdapter`.\n\n## Verification\n\n`pnpm exec vitest run apps/runner/src/job-runner.test.ts`, then recipe checks (`run_checks`).",
  "findings": [
    "triage: Ticket has a concrete error log and one clear bug: an unhandled promise rejection kills the runner when a job is revoked before the Claude harness reports a session id. Investigating the adapter/runner session-id lifecycle now.",
    "investigating: Root cause: JobRunner.track chained .then() on session.id without a rejection handler; ClaudeCodeAdapter rejects that promise when a revoked/paused session ends before reporting an id, and Bun exits on the unhandled rejection. Added the handler and a regression test that reproduced the crash before the fix.",
    "implementing: Fix and regression test are in place; the new test reproduces the unhandled rejection before the fix and passes after it. The full job-runner suite (12 tests), biome, and the runner typecheck pass."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T00:24:55.772Z"
}
```
