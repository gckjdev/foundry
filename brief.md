# Handoff brief: Run recipe warm, install, and checks before marking a runner ready

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T05:56:47.471Z

## Plan

1. `apps/runner/src/workspace.ts` — add `createDetachedWorktree({fullName, branch, id, token})`: ensureMirror, `git worktree add --detach <path> origin/<branch>`; cleanup reuses existing `removeWorktree`.
2. `apps/runner/src/readiness.ts` — keep `checkRecipe` (PATH/os/postgres) as the cheap short-circuit; after it passes, create the temporary worktree and run recipe steps in order: each `warm`, `install` if set, each `checks[]` with its `timeout_sec`. Env = `httpProxyEnv()` + `FOUNDRY_TEST_DATABASE_URL` from daemon `postgresUrl`; command wrapper from the daemon. Deadlines shrink against a 20-minute overall cap. First non-zero exit/timed-out step returns `{ready:false, reason:"<step> failed: <scrubbed tail>"}` (≤300 chars). Remove worktree in `finally`. Guard against overlapping passes and keep the `reported` map so heartbeats don't re-run unchanged recipes.
3. `apps/runner/src/daemon.ts` — pass a `wrap: () => this.wrap` getter into `ReadinessReporter` (wrap is set in `start()`).
4. `apps/runner/src/readiness.test.ts` — new tests: passing check → ready + temp worktree cleaned; failing check → not ready with reason naming the check; os/PATH failure → not ready with no worktree created; unchanged recipeSha → no re-run, changed sha → re-run.
5. Verify: `pnpm exec biome check --write` on touched files, targeted vitest, `pnpm --filter @foundry/runner typecheck`, then full `run_checks`.

## Findings

- triage: Ticket is clear: extend readiness beyond PATH/os/postgres checks to actually run recipe warm/install/checks in a temporary worktree of origin/<defaultBranch>, ignoring heartbeats unless recipeSha changed. Now locating Workspace, runCommand/command wrapper, recipe schema, and testing helpers.
- investigating: Readiness currently only runs cheap checks; Workspace only creates job worktrees; daemon has proxy env, postgresUrl and an optional wrap set in start(). Implementing a detached temp worktree + step runner with a 20-minute cap and cleanup.
- implementing: Implemented temp detached worktree creation, readiness step runner (warm → install → checks) with per-check timeouts and a 20-minute overall cap, proxy/test-database env, scrubbed reasons, finally cleanup, overlap guard, and the daemon wrap getter. Targeted readiness/daemon tests (10) and all runner tests (23) pass; runner typecheck passes.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "33b79c33-dbfe-4763-ac05-acf67cde26ca",
  "title": "Run recipe warm, install, and checks before marking a runner ready",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "23e77a2d-111d-44bc-bb99-efd020c68e2a",
  "plan": "1. `apps/runner/src/workspace.ts` — add `createDetachedWorktree({fullName, branch, id, token})`: ensureMirror, `git worktree add --detach <path> origin/<branch>`; cleanup reuses existing `removeWorktree`.\n2. `apps/runner/src/readiness.ts` — keep `checkRecipe` (PATH/os/postgres) as the cheap short-circuit; after it passes, create the temporary worktree and run recipe steps in order: each `warm`, `install` if set, each `checks[]` with its `timeout_sec`. Env = `httpProxyEnv()` + `FOUNDRY_TEST_DATABASE_URL` from daemon `postgresUrl`; command wrapper from the daemon. Deadlines shrink against a 20-minute overall cap. First non-zero exit/timed-out step returns `{ready:false, reason:\"<step> failed: <scrubbed tail>\"}` (≤300 chars). Remove worktree in `finally`. Guard against overlapping passes and keep the `reported` map so heartbeats don't re-run unchanged recipes.\n3. `apps/runner/src/daemon.ts` — pass a `wrap: () => this.wrap` getter into `ReadinessReporter` (wrap is set in `start()`).\n4. `apps/runner/src/readiness.test.ts` — new tests: passing check → ready + temp worktree cleaned; failing check → not ready with reason naming the check; os/PATH failure → not ready with no worktree created; unchanged recipeSha → no re-run, changed sha → re-run.\n5. Verify: `pnpm exec biome check --write` on touched files, targeted vitest, `pnpm --filter @foundry/runner typecheck`, then full `run_checks`.",
  "findings": [
    "triage: Ticket is clear: extend readiness beyond PATH/os/postgres checks to actually run recipe warm/install/checks in a temporary worktree of origin/<defaultBranch>, ignoring heartbeats unless recipeSha changed. Now locating Workspace, runCommand/command wrapper, recipe schema, and testing helpers.",
    "investigating: Readiness currently only runs cheap checks; Workspace only creates job worktrees; daemon has proxy env, postgresUrl and an optional wrap set in start(). Implementing a detached temp worktree + step runner with a 20-minute cap and cleanup.",
    "implementing: Implemented temp detached worktree creation, readiness step runner (warm → install → checks) with per-check timeouts and a 20-minute overall cap, proxy/test-database env, scrubbed reasons, finally cleanup, overlap guard, and the daemon wrap getter. Targeted readiness/daemon tests (10) and all runner tests (23) pass; runner typecheck passes."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T05:56:47.471Z"
}
```
