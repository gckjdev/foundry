# Handoff brief: Log a warning when the confidence gate skips the automatic PR review

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-12T09:21:05.969Z

## Plan

1. `packages/control/src/merge-gate.ts`: in `evaluateJobGate`, after the policy/CI context is known and before the auto-review gate hold, emit a `ctx.log.warn("auto PR review disabled", { jobId, repo: repo.fullName })` when `job.kind === "ticket" && !policy.auto_pr_review`. This turns the silent skip (including a stale cached policy) into an actionable control-plane log line without changing gate behavior.
2. `packages/control/src/control.test.ts`: add a test that replaces `env.ctx.log` with a `createLogger` sink, runs a ticket job in `pr_ci` under the default policy (`auto_pr_review` false), and asserts one structured `warn` line with the job id and repo.
3. Run `pnpm exec biome check --write` on the touched files, then the targeted control test with `FOUNDRY_TEST_DATABASE_URL`, plus `pnpm --filter @foundry/control typecheck`.

## Findings

- triage: The ticket is clear: a ticket job in pr_ci with `auto_pr_review` disabled is skipped silently in `evaluateJobGate` (via `maybeStartPrReview`'s early return). The fix is a single `ctx.log.warn` at the gate with jobId/repo fields, plus a test capturing the structured log line.
- investigating: Plan recorded: one gate warning plus a structured-log test.
- implementing: Added a `ctx.log.warn("auto PR review disabled", { jobId, repo })` in `evaluateJobGate` when a ticket job reaches the gate with `auto_pr_review` off, plus a test capturing the structured warn line. Targeted control tests (34) and control typecheck pass.
- review: Reviewed the diff against origin/main (2 files, +48/−1). Code quality: the change does exactly what ticket #101 asks — `evaluateJobGate` now emits `auto PR review disabled` with `jobId` and `repo.fullName` for a ticket job in `pr_ci` when `policy.auto_pr_review` is false, before the review-gate hold, and gate behavior is unchanged. Message/fields follow `docs/logging.md` conventions (stable message, ids as fields, `repo` = full name). A targeted test in `control.test.ts` seeds the default (disabled) policy, runs a ticket job at the gate, and asserts the structured warn line — adequate for a logging-only change. Two non-blocking nits: the warn fires on every gate evaluation even though `auto_pr_review` defaults to false (log volume, see finding), and the test only covers the positive case. UI design: not applicable — no UI files or user-facing behavior changed. Security: no concerns — one fixed message plus non-sensitive ids, no secrets, injection or authorization surface touched either way. I could not execute the test suite here because this review worktree has no `node_modules`; verification of the test claim rests on inspection plus the implementer's reported targeted run.
- reviewing: Reviewer approved. Running the recipe checks now.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "2abfdd8e-7dd1-4628-af40-91a758525aaf",
  "title": "Log a warning when the confidence gate skips the automatic PR review",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "50ef879b-130e-43ac-b5d9-02f726072daf",
  "plan": "1. `packages/control/src/merge-gate.ts`: in `evaluateJobGate`, after the policy/CI context is known and before the auto-review gate hold, emit a `ctx.log.warn(\"auto PR review disabled\", { jobId, repo: repo.fullName })` when `job.kind === \"ticket\" && !policy.auto_pr_review`. This turns the silent skip (including a stale cached policy) into an actionable control-plane log line without changing gate behavior.\n2. `packages/control/src/control.test.ts`: add a test that replaces `env.ctx.log` with a `createLogger` sink, runs a ticket job in `pr_ci` under the default policy (`auto_pr_review` false), and asserts one structured `warn` line with the job id and repo.\n3. Run `pnpm exec biome check --write` on the touched files, then the targeted control test with `FOUNDRY_TEST_DATABASE_URL`, plus `pnpm --filter @foundry/control typecheck`.",
  "findings": [
    "triage: The ticket is clear: a ticket job in pr_ci with `auto_pr_review` disabled is skipped silently in `evaluateJobGate` (via `maybeStartPrReview`'s early return). The fix is a single `ctx.log.warn` at the gate with jobId/repo fields, plus a test capturing the structured log line.",
    "investigating: Plan recorded: one gate warning plus a structured-log test.",
    "implementing: Added a `ctx.log.warn(\"auto PR review disabled\", { jobId, repo })` in `evaluateJobGate` when a ticket job reaches the gate with `auto_pr_review` off, plus a test capturing the structured warn line. Targeted control tests (34) and control typecheck pass.",
    "review: Reviewed the diff against origin/main (2 files, +48/−1). Code quality: the change does exactly what ticket #101 asks — `evaluateJobGate` now emits `auto PR review disabled` with `jobId` and `repo.fullName` for a ticket job in `pr_ci` when `policy.auto_pr_review` is false, before the review-gate hold, and gate behavior is unchanged. Message/fields follow `docs/logging.md` conventions (stable message, ids as fields, `repo` = full name). A targeted test in `control.test.ts` seeds the default (disabled) policy, runs a ticket job at the gate, and asserts the structured warn line — adequate for a logging-only change. Two non-blocking nits: the warn fires on every gate evaluation even though `auto_pr_review` defaults to false (log volume, see finding), and the test only covers the positive case. UI design: not applicable — no UI files or user-facing behavior changed. Security: no concerns — one fixed message plus non-sensitive ids, no secrets, injection or authorization surface touched either way. I could not execute the test suite here because this review worktree has no `node_modules`; verification of the test claim rests on inspection plus the implementer's reported targeted run.",
    "reviewing: Reviewer approved. Running the recipe checks now."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-12T09:21:05.969Z"
}
```
