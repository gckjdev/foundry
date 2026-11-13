# Handoff brief: Runner double-drives a job after drop→re-claim, clobbering the MCP tool token

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-13T01:36:17.507Z

## Plan

## Goal
Stop the runner from driving the same job twice after a drop→re-claim, which clobbers the per-job MCP token and makes the reviewer's `review` calls 403.

## Changes
1. `apps/runner/src/daemon.ts`
   - In `claimLoop`, after `claim()`, if `this.running.has(job.id)`, log a warning and `continue` instead of constructing a second `JobRunner` (the second would overwrite the map entry and `ToolServer.register` would clobber the live session's token).
   - Harden the runner's `finally`: only delete the map entry when it still points at this `JobRunner`, so a stale runner can never delete a newer one's entry.
2. `apps/runner/src/tool-server.ts`
   - `register()` throws when the job id is already registered instead of silently overwriting the token. A double-drive now fails loudly rather than 403-ing every later tool call.
3. `packages/control/src/runners.ts`
   - Include jobs requeued by `requeueDroppedJobs` in the heartbeat's `revokedJobIds`, so a runner that still has a `JobRunner` for a job the sweeper dropped tears it down before it can re-claim it.

## Tests
- `apps/runner/src/daemon.test.ts`: when `claim()` returns a job the daemon is already running, exactly one harness session starts and the map still holds one entry.
- `apps/runner/src/tool-server.test.ts` (new): a second `register()` for the same job throws; the first token still works over the socket and a stale token gets the 403.
- `packages/control/src/control.test.ts`: heartbeat `revokedJobIds` contains a job `requeueDroppedJobs` just requeued (DB test; skips without `FOUNDRY_TEST_DATABASE_URL`).

## Verify
`pnpm exec biome check --write` on touched files, then targeted Vitest, then the recipe checks via `run_checks`.

## Findings

- triage: Ticket #113 describes a double-drive: the runner re-claims a job it is already running, spawns a second JobRunner, and ToolServer.register clobbers the first session's token, causing 403s on MCP calls. The ticket gives three concrete fix points, so no clarification is needed; investigating the runner daemon, tool server, sweeper, and existing tests.
- investigating: Root causes confirmed: claimLoop overwrites an existing running entry (and the old runner's finally then deletes the new entry), ToolServer.register silently clobbers the token, and heartbeat revocation only covers jobs reported in runningJobIds. Implementing the guard, loud duplicate-registration failure, and including requeued dropped jobs in revocation.
- implementing: Implemented three fixes: claimLoop now skips a job already in this.running (and a stale runner can no longer delete a newer map entry), ToolServer.register throws instead of clobbering an existing token, and heartbeat revokedJobIds now includes jobs requeueDroppedJobs just re-queued. Added a daemon regression test (verified it fails with the guard removed: run called twice), a new tool-server test (verified the duplicate-register test fails without the throw), and a DB-backed control test for the revocation. Lint, targeted typechecks, and the runner tests pass; the control test skips locally without FOUNDRY_TEST_DATABASE_URL.
- review: Reviewed all three changes plus their tests. Code quality: the core fix is right — `claimLoop` now refuses a second `JobRunner` for a job in `this.running` (so `ToolServer.register` can no longer clobber the live session's MCP token), the runner `finally` only clears its own map entry, `register` throws on a duplicate instead of silently overwriting, and heartbeat `revokedJobIds` now includes jobs the sweeper just requeued. Tests cover the duplicate-claim skip (verified to fail without the guard), the duplicate `register` throw with the original token still working, stale-token 403, and the heartbeat revocation (DB-gated). Remaining notes are non-blocking: a small new revocation race on jobs re-claimed while a heartbeat is in flight, a transient claim stall in the revoke→re-claim path, and stale docs for `revokedJobIds`. UI design: not applicable — no UI files or user-facing panel behavior changed. Security: no secrets, auth or input handling touched; the per-job token is now harder to clobber, which is an improvement. I could not re-run the suites here (no installed dependencies in the review checkout); verification is from reading the tests and the implementer's reported runs.
- reviewing: Reviewer approved the change. Running the repo's recipe checks (lint, typecheck, full test suite) to verify.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "1940f763-4941-4aa6-a6a0-d471b75bb8b2",
  "title": "Runner double-drives a job after drop→re-claim, clobbering the MCP tool token",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "0146fff5-9dea-4506-99b7-26d942b9ea0b",
  "plan": "## Goal\nStop the runner from driving the same job twice after a drop→re-claim, which clobbers the per-job MCP token and makes the reviewer's `review` calls 403.\n\n## Changes\n1. `apps/runner/src/daemon.ts`\n   - In `claimLoop`, after `claim()`, if `this.running.has(job.id)`, log a warning and `continue` instead of constructing a second `JobRunner` (the second would overwrite the map entry and `ToolServer.register` would clobber the live session's token).\n   - Harden the runner's `finally`: only delete the map entry when it still points at this `JobRunner`, so a stale runner can never delete a newer one's entry.\n2. `apps/runner/src/tool-server.ts`\n   - `register()` throws when the job id is already registered instead of silently overwriting the token. A double-drive now fails loudly rather than 403-ing every later tool call.\n3. `packages/control/src/runners.ts`\n   - Include jobs requeued by `requeueDroppedJobs` in the heartbeat's `revokedJobIds`, so a runner that still has a `JobRunner` for a job the sweeper dropped tears it down before it can re-claim it.\n\n## Tests\n- `apps/runner/src/daemon.test.ts`: when `claim()` returns a job the daemon is already running, exactly one harness session starts and the map still holds one entry.\n- `apps/runner/src/tool-server.test.ts` (new): a second `register()` for the same job throws; the first token still works over the socket and a stale token gets the 403.\n- `packages/control/src/control.test.ts`: heartbeat `revokedJobIds` contains a job `requeueDroppedJobs` just requeued (DB test; skips without `FOUNDRY_TEST_DATABASE_URL`).\n\n## Verify\n`pnpm exec biome check --write` on touched files, then targeted Vitest, then the recipe checks via `run_checks`.",
  "findings": [
    "triage: Ticket #113 describes a double-drive: the runner re-claims a job it is already running, spawns a second JobRunner, and ToolServer.register clobbers the first session's token, causing 403s on MCP calls. The ticket gives three concrete fix points, so no clarification is needed; investigating the runner daemon, tool server, sweeper, and existing tests.",
    "investigating: Root causes confirmed: claimLoop overwrites an existing running entry (and the old runner's finally then deletes the new entry), ToolServer.register silently clobbers the token, and heartbeat revocation only covers jobs reported in runningJobIds. Implementing the guard, loud duplicate-registration failure, and including requeued dropped jobs in revocation.",
    "implementing: Implemented three fixes: claimLoop now skips a job already in this.running (and a stale runner can no longer delete a newer map entry), ToolServer.register throws instead of clobbering an existing token, and heartbeat revokedJobIds now includes jobs requeueDroppedJobs just re-queued. Added a daemon regression test (verified it fails with the guard removed: run called twice), a new tool-server test (verified the duplicate-register test fails without the throw), and a DB-backed control test for the revocation. Lint, targeted typechecks, and the runner tests pass; the control test skips locally without FOUNDRY_TEST_DATABASE_URL.",
    "review: Reviewed all three changes plus their tests. Code quality: the core fix is right — `claimLoop` now refuses a second `JobRunner` for a job in `this.running` (so `ToolServer.register` can no longer clobber the live session's MCP token), the runner `finally` only clears its own map entry, `register` throws on a duplicate instead of silently overwriting, and heartbeat `revokedJobIds` now includes jobs the sweeper just requeued. Tests cover the duplicate-claim skip (verified to fail without the guard), the duplicate `register` throw with the original token still working, stale-token 403, and the heartbeat revocation (DB-gated). Remaining notes are non-blocking: a small new revocation race on jobs re-claimed while a heartbeat is in flight, a transient claim stall in the revoke→re-claim path, and stale docs for `revokedJobIds`. UI design: not applicable — no UI files or user-facing panel behavior changed. Security: no secrets, auth or input handling touched; the per-job token is now harder to clobber, which is an improvement. I could not re-run the suites here (no installed dependencies in the review checkout); verification is from reading the tests and the implementer's reported runs.",
    "reviewing: Reviewer approved the change. Running the repo's recipe checks (lint, typecheck, full test suite) to verify."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-13T01:36:17.507Z"
}
```
