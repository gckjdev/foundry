# Handoff brief: It takes time for Runner to be ready

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-12T01:02:11.122Z

## Plan

## Root cause

`Daemon.start()` awaits `tick()`, and `tick()` awaits `ReadinessReporter.sync()`. `sync()` clones/fetches the mirror into a throwaway worktree and runs the **whole** `.foundry/recipe.yaml` — `pnpm install`, `pnpm lint`, full `turbo typecheck`, and the full Vitest suite. Only after that does the daemon install the heartbeat interval and start claiming. The provided log matches exactly: 00:32:47 start → 00:37:19 "repo readiness passed" → 00:37:20 "runner connected". The control plane already persists the last readiness row (`runner_repo_readiness`, keyed by `recipeSha`), so blocking startup on a fresh re-run buys nothing for job routing when the recipe is unchanged.

## Plan

1. `apps/runner/src/daemon.ts`
   - Log startup phases with durations: `runner starting`, `runner harnesses detected`, `startup gc removed worktrees` (only when non-zero), `runner started`.
   - In `tick()`, kick readiness off in the background (`void … .catch(log)`) instead of awaiting it, so heartbeats and claims resume immediately. Safe because `claim` already requires a matching persisted readiness row for the repo (onboarding jobs are the documented exception).
2. `apps/runner/src/readiness.ts`
   - Log `readiness check started`, `readiness mirror ready`, `readiness worktree ready`, then `readiness step started` / `readiness step passed` / `readiness step failed` per recipe step with `step`, `stepIndex`, `steps`, `durationMs`, and add `durationMs` to `repo readiness passed` / `repo readiness failed`. This makes the current step (and any blocker) visible while the pass runs.
   - Reuse the already-fetched mirror when creating the readiness worktree (pass it into `createDetachedWorktree`) instead of fetching twice per pass.
3. Tests
   - `readiness.test.ts`: a logger sink test asserting the step log sequence and durations (warm → install → check).
   - `daemon.test.ts`: with `heartbeatResponse.repos` pointing at a repo whose recipe check sleeps, `start()` returns before the readiness POST lands, and the readiness report still arrives.
4. Verify: `pnpm exec biome check --write` on touched files, targeted Vitest run, then `run_checks`.

## Findings

- triage: Ticket #94 is clear: the runner takes ~4.5 min between start and "repo readiness passed" (00:32:47 → 00:37:19), then connects. Goal is to shorten that and log each startup step. I'm now locating the readiness check code and its timing.
- investigating: Root cause confirmed: Daemon.start() → tick() → readiness.sync() runs the full recipe (install, lint, typecheck, full tests) synchronously before any further heartbeat or claim, matching the 4.5-minute gap in the log. Implementing background readiness plus per-step startup logs.
- implementing: Implemented: readiness now runs in the background so the daemon heartbeats and claims immediately, readiness logs every phase (mirror fetch, worktree, each recipe step with durations), startup logs its phases, and concurrent mirror fetches are deduped. Added tests for background startup and step logging; all 51 runner tests and the runner typecheck pass locally.
- review: The startup-phase logging (AC2) is solid and the mirror double-fetch fix is a real improvement. However, making readiness fire-and-forget breaks job claiming in the e2e harness and delays the first claim by a whole heartbeat in production: nothing re-runs `claimLoop()` once the background readiness report lands.

Areas checked: code quality/correctness (full diff, daemon/reporting control flow, scheduler gating in packages/control/src/claim.ts, e2e harness, tests), UI design (not applicable — no component/page/style/token files changed), security (no findings — no secrets, new dependencies, auth or injection surface touched).
- implementing: Fixed the blocking finding: the background readiness pass now re-pokes claimLoop when it settles (and claimLoop coalesces pokes that arrive mid-loop via a claimAgain flag), so a job queued during the first tick is claimed as soon as the readiness report lands even with a long heartbeat interval. Added a daemon test with a readiness-gated fake controlling plane proving the first claim is refused and the post-readiness claim takes it. Reworded the safety comment per the reviewer's suggestion and added a test for the ensureMirror in-flight dedupe. Of the non-blocking notes, stop() coordination of an in-flight recipe child is pre-existing (periodic readiness passes already outlive shutdown) and aborting it needs new signal plumbing, so I left it out of this ticket.
- review: Reviewed `foundry/54249dce-it-takes-time-for-runner-to-be-ready` against `origin/main` (6 files, +291/−36). Static review only: this clean checkout has no node_modules and the review playbook forbids installing, so I did not execute Vitest/typecheck/biome.

**Code quality.** Root cause is correct and the fix matches it: `Daemon.start()` no longer blocks on `ReadinessReporter.sync()`; heartbeats/claims run immediately and the readiness pass is detached with a re-poke (`claimAgain`) when it settles. I verified the safety premise the comment relies on: `schedulerSnapshot` only puts a repo in a runner's `readyRepoIds` when `runner_repo_readiness.ready` and `recipeSha === repos.recipeSha` (packages/control/src/claim.ts:35-57, packages/shared/src/scheduler.ts:56), so a pre-readiness claim cannot land on a repo not proven at that sha — except onboarding, which is designed to run without readiness. The `claimAgain` coalescing is sound: re-entrant `claimLoop()` calls set the flag (no lost poke, since there is no await between the do/while condition and `claiming = false`), and a throwing `api.claim()` exits the loop rather than spinning. Both ACs are met: startup is no longer gated on the multi-minute recipe, and the log now shows `runner starting` → harness detection → gc → mirror fetch → worktree → per-step `readiness step started/passed/failed` (with durations/step index) → `repo readiness passed|failed` → `runner started`. Regression tests are real: the background-start test fails on the old code (start awaited readiness), the readiness-gated claim test only passes with both the detach and the post-readiness re-poke, and the `ensureMirror` in-flight dedupe test is timing-safe. Scope is tight — no unrelated edits, debug leftovers, or dead code, and the double mirror fetch per readiness pass is genuinely removed. The e2e harness (`heartbeatMs: 3_600_000`, no realtime URL) still progresses because the new re-poke — not a heartbeat — claims after readiness lands; its 20–30s waits absorb the ~2s background pass.

**UI design.** Not applicable: no components, pages, styles or tokens changed. The only user-facing surface is runner CLI/log output, which is covered above.

**Security.** No secrets, credentials or env values reach the new logs — records carry `repo`, step name, `stepIndex/stepCount`, `durationMs`, `timedOut`/`exitCode` only; recipe `run` text and `secretEnvValues` are not logged, and `failureReason` output is scrubbed. No new dependencies, auth checks or injection surface.

Findings below are non-blocking suggestions.
- reviewing: The reviewer approved. Running the repo recipe checks (lint, typecheck, full test suite) on the final branch.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "54249dce-0e7b-407d-9f8a-131eaf0134eb",
  "title": "It takes time for Runner to be ready",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "ded612e2-849d-407a-8b04-e98c90ca9499",
  "plan": "## Root cause\n\n`Daemon.start()` awaits `tick()`, and `tick()` awaits `ReadinessReporter.sync()`. `sync()` clones/fetches the mirror into a throwaway worktree and runs the **whole** `.foundry/recipe.yaml` — `pnpm install`, `pnpm lint`, full `turbo typecheck`, and the full Vitest suite. Only after that does the daemon install the heartbeat interval and start claiming. The provided log matches exactly: 00:32:47 start → 00:37:19 \"repo readiness passed\" → 00:37:20 \"runner connected\". The control plane already persists the last readiness row (`runner_repo_readiness`, keyed by `recipeSha`), so blocking startup on a fresh re-run buys nothing for job routing when the recipe is unchanged.\n\n## Plan\n\n1. `apps/runner/src/daemon.ts`\n   - Log startup phases with durations: `runner starting`, `runner harnesses detected`, `startup gc removed worktrees` (only when non-zero), `runner started`.\n   - In `tick()`, kick readiness off in the background (`void … .catch(log)`) instead of awaiting it, so heartbeats and claims resume immediately. Safe because `claim` already requires a matching persisted readiness row for the repo (onboarding jobs are the documented exception).\n2. `apps/runner/src/readiness.ts`\n   - Log `readiness check started`, `readiness mirror ready`, `readiness worktree ready`, then `readiness step started` / `readiness step passed` / `readiness step failed` per recipe step with `step`, `stepIndex`, `steps`, `durationMs`, and add `durationMs` to `repo readiness passed` / `repo readiness failed`. This makes the current step (and any blocker) visible while the pass runs.\n   - Reuse the already-fetched mirror when creating the readiness worktree (pass it into `createDetachedWorktree`) instead of fetching twice per pass.\n3. Tests\n   - `readiness.test.ts`: a logger sink test asserting the step log sequence and durations (warm → install → check).\n   - `daemon.test.ts`: with `heartbeatResponse.repos` pointing at a repo whose recipe check sleeps, `start()` returns before the readiness POST lands, and the readiness report still arrives.\n4. Verify: `pnpm exec biome check --write` on touched files, targeted Vitest run, then `run_checks`.",
  "findings": [
    "triage: Ticket #94 is clear: the runner takes ~4.5 min between start and \"repo readiness passed\" (00:32:47 → 00:37:19), then connects. Goal is to shorten that and log each startup step. I'm now locating the readiness check code and its timing.",
    "investigating: Root cause confirmed: Daemon.start() → tick() → readiness.sync() runs the full recipe (install, lint, typecheck, full tests) synchronously before any further heartbeat or claim, matching the 4.5-minute gap in the log. Implementing background readiness plus per-step startup logs.",
    "implementing: Implemented: readiness now runs in the background so the daemon heartbeats and claims immediately, readiness logs every phase (mirror fetch, worktree, each recipe step with durations), startup logs its phases, and concurrent mirror fetches are deduped. Added tests for background startup and step logging; all 51 runner tests and the runner typecheck pass locally.",
    "review: The startup-phase logging (AC2) is solid and the mirror double-fetch fix is a real improvement. However, making readiness fire-and-forget breaks job claiming in the e2e harness and delays the first claim by a whole heartbeat in production: nothing re-runs `claimLoop()` once the background readiness report lands.\n\nAreas checked: code quality/correctness (full diff, daemon/reporting control flow, scheduler gating in packages/control/src/claim.ts, e2e harness, tests), UI design (not applicable — no component/page/style/token files changed), security (no findings — no secrets, new dependencies, auth or injection surface touched).",
    "implementing: Fixed the blocking finding: the background readiness pass now re-pokes claimLoop when it settles (and claimLoop coalesces pokes that arrive mid-loop via a claimAgain flag), so a job queued during the first tick is claimed as soon as the readiness report lands even with a long heartbeat interval. Added a daemon test with a readiness-gated fake controlling plane proving the first claim is refused and the post-readiness claim takes it. Reworded the safety comment per the reviewer's suggestion and added a test for the ensureMirror in-flight dedupe. Of the non-blocking notes, stop() coordination of an in-flight recipe child is pre-existing (periodic readiness passes already outlive shutdown) and aborting it needs new signal plumbing, so I left it out of this ticket.",
    "review: Reviewed `foundry/54249dce-it-takes-time-for-runner-to-be-ready` against `origin/main` (6 files, +291/−36). Static review only: this clean checkout has no node_modules and the review playbook forbids installing, so I did not execute Vitest/typecheck/biome.\n\n**Code quality.** Root cause is correct and the fix matches it: `Daemon.start()` no longer blocks on `ReadinessReporter.sync()`; heartbeats/claims run immediately and the readiness pass is detached with a re-poke (`claimAgain`) when it settles. I verified the safety premise the comment relies on: `schedulerSnapshot` only puts a repo in a runner's `readyRepoIds` when `runner_repo_readiness.ready` and `recipeSha === repos.recipeSha` (packages/control/src/claim.ts:35-57, packages/shared/src/scheduler.ts:56), so a pre-readiness claim cannot land on a repo not proven at that sha — except onboarding, which is designed to run without readiness. The `claimAgain` coalescing is sound: re-entrant `claimLoop()` calls set the flag (no lost poke, since there is no await between the do/while condition and `claiming = false`), and a throwing `api.claim()` exits the loop rather than spinning. Both ACs are met: startup is no longer gated on the multi-minute recipe, and the log now shows `runner starting` → harness detection → gc → mirror fetch → worktree → per-step `readiness step started/passed/failed` (with durations/step index) → `repo readiness passed|failed` → `runner started`. Regression tests are real: the background-start test fails on the old code (start awaited readiness), the readiness-gated claim test only passes with both the detach and the post-readiness re-poke, and the `ensureMirror` in-flight dedupe test is timing-safe. Scope is tight — no unrelated edits, debug leftovers, or dead code, and the double mirror fetch per readiness pass is genuinely removed. The e2e harness (`heartbeatMs: 3_600_000`, no realtime URL) still progresses because the new re-poke — not a heartbeat — claims after readiness lands; its 20–30s waits absorb the ~2s background pass.\n\n**UI design.** Not applicable: no components, pages, styles or tokens changed. The only user-facing surface is runner CLI/log output, which is covered above.\n\n**Security.** No secrets, credentials or env values reach the new logs — records carry `repo`, step name, `stepIndex/stepCount`, `durationMs`, `timedOut`/`exitCode` only; recipe `run` text and `secretEnvValues` are not logged, and `failureReason` output is scrubbed. No new dependencies, auth checks or injection surface.\n\nFindings below are non-blocking suggestions.",
    "reviewing: The reviewer approved. Running the repo recipe checks (lint, typecheck, full test suite) on the final branch."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-12T01:02:11.122Z"
}
```
