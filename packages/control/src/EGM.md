# @foundry/control — Source

## Overview

Control-plane business logic. Every module here is called by Next.js route handlers or by the runner HTTP API; routes should only parse, auth, call into this package, and return. It owns job creation, claim, state transitions, runner registration, GitHub sync, the merge gate, PR review, onboarding, metrics and the sweeper.

## Interface

Public entry points are re-exported by `[index.ts]`. Notable symbols by file:

- `[context.ts]` — `ControlContext`, `GitHubFactory`, `DeferredEvent`, `newDeferredEvents`, `sendDeferredEvents`, `getContext`, `setContextForTests`, `requireJob`, `ownedJob`.
- `[artifacts.ts]` — `saveArtifact`, `listArtifacts`, `readArtifact`, `MAX_ARTIFACT_BYTES`, `ArtifactSchema` re-export.
- `[claim.ts]` — `claimJob`, `ClaimResult`, `resumeModeFor`, `spendGuard`, `portsInUse`.
- `[github-sync.ts]` — `syncIssueStatus`, `syncIssueComment`, `syncPrBody`, `bestEffort`.
- `[ingest.ts]` — `ingestWebhook`, `storeWebhook`, `drainWebhookInbox`, `handleIssueOpened`, `handlePullRequestEvent`, `MAX_ATTEMPTS`.
- `[jobs.ts]` — `createJobFromIssue`, `transitionJob`, `failJob`, `retryJob`, `cancelJob`, `transitionForStage`, `TERMINAL_STATUSES` re-export.
- `[merge-gate.ts]` — `evaluateJobGate`, `GateOutcome`, `mergeModeFor`.
- `[metrics.ts]` — `teamMetrics`, `jobMetrics`, `runningTotals`, `dailySpend`.
- `[notify.ts]` — `notifyTeam`, `notificationFor`, webhook fan-out via `@foundry/shared/notify`.
- `[onboarding.ts]` — `startOnboarding`, `submitOnboardingResult`, `ONBOARDING_JOB_KIND`.
- `[pr-review.ts]` — `maybeStartPrReview`, `submitPrReview`, `NO_CI_GRACE_MS`.
- `[prs.ts]` — `openPullRequest`, `renderPrBody`, `prBranchFor`.
- `[queries.ts]` — `listJobs`, `getJob`, `jobEvents`, `jobQuestions`, `jobInputs`, `runnerJobs`, `panelCounts`.
- `[questions.ts]` — `askQuestion`, `answerQuestion`, `pendingQuestions`, `resumeWithAnswer`.
- `[repos.ts]` — `upsertRepo`, `listRepos`, `repoPolicy`, `repoRecipe`, `setRepoConfig`.
- `[runner-api.ts]` — `joinRunner`, `heartbeat`, `claim`, `runnerStage`, `runnerCheckpoint`, `runnerEvidence`, `runnerQuestion`, `runnerAnswer`, `runnerReview`, `runnerArtifact`, `runnerEvents`, `runnerLog`.
- `[runners.ts]` — `createJoinToken`, `registerRunner`, `listRunners`, `runnerByToken`, `revokeRunner`, `runnerRepoReadiness`.
- `[skills.ts]` — `listAvailableSkills`, `resolveSkills`, skill materialization helpers.
- `[sweeper.ts]` — `sweepOnce`, `startSweeper`, `SWEEP_INTERVAL_MS`, `DROPPED_JOB_GRACE_MS`.
- `[teams.ts]` — `createTeam`, `teamById`, `membership`, `inviteMembers`, `acceptInvite`.
- `[testing.ts]` — `newTestContext`, `seedTeam`, `seedRunner`, `seedJob`, `FakeGitHubFactory`.
- `[worker.ts]` — `registerWorker`, `startWorker`, `WorkerOptions` (sweeper + inbox drain loop).

## Invariants

- Every status move goes through `transitionJob`, which locks the row `for update`, calls `assertTransition`, sets `startedAt`/`finishedAt`, clears `runnerId` when leaving runner stages, and emits a `stage_changed` event `[jobs.ts:transitionJob]`.
- GitHub sync after a transition is best-effort: a failure is logged, never rolled back `[github-sync.ts:bestEffort]`.
- `claimJob` uses `SKIP LOCKED`, refuses jobs over the spend cap, and picks `resumeMode` sticky → portable → fresh `[claim.ts:claimJob][claim.ts:resumeModeFor]`.
- `createJobFromIssue` keeps one live job per issue and revives a non-merged terminal job instead of creating a second `[ingest.ts:handleIssueOpened][jobs.ts:createJobFromIssue]`.
- `recordEvents` accumulates usage cost and token totals on the job `[runner-api.ts:runnerEvents]`.
- `storeWebhook` dedupes on the `webhook_inbox_delivery_idx` unique index; processing retries up to `MAX_ATTEMPTS = 5` before marking failed `[ingest.ts:storeWebhook][ingest.ts:MAX_ATTEMPTS]`.
- `mergeModeFor` forces `off` for onboarding jobs; `evaluateJobGate` waits for an auto review, squash-merges on pass, and hands over to a human otherwise `[merge-gate.ts:mergeModeFor][merge-gate.ts:evaluateJobGate]`.
- `maybeStartPrReview` starts at most once per head SHA and tolerates `NO_CI_GRACE_MS = 2 minutes` with no CI `[pr-review.ts:maybeStartPrReview]`.
- `submitPrReview` posts a `COMMENT` review, never an approval, and enforces `max_review_loops` `[pr-review.ts:submitPrReview]`.
- `ownedJob` requires the job's team and runner to match and the status to be in `RUNNING_STATUSES` `[context.ts:ownedJob]`.
- `runnerStage` moves to a requeue state, records `resumeStage`, and opens the sticky window `[runner-api.ts:runnerStage]`.
- `heartbeat` requeues dropped runners' jobs and returns revoked/keep/jobLimits `[runner-api.ts:heartbeat]`.
- The worker ticks every `SWEEP_INTERVAL_MS = 30_000`; a job with no heartbeat for `DROPPED_JOB_GRACE_MS = 2 * HEARTBEAT_INTERVAL_MS` is dropped `[sweeper.ts][sweeper.ts:DROPPED_JOB_GRACE_MS]`.
- Join tokens are prefixed `fdj_`, live 7 days; realtime tokens live 1 hour `[runners.ts:createJoinToken]`. A rejected join says whether the token expired or is invalid, and only reports expiry after the signature verifies `[runners.ts:joinRunner][tokens.ts:verifyTokenDetailed]`.

## Side Effects

- Reads and writes Postgres through the injected `Database`.
- Calls GitHub via the `GitHubClient` from the context (issue labels, comments, PRs, reviews).
- Emits deferred realtime events (`newDeferredEvents`/`sendDeferredEvents`) to `@foundry/realtime`.
- Sends webhook notifications through `notifyTeam`.
- Starts background timers in `startSweeper` / `startWorker`; no I/O happens at import time.

## Verification

- Run: `pnpm test`
