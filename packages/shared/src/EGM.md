# @foundry/shared — Source

## Overview

Leaf package of the Foundry monorepo: pure TypeScript types, Zod schemas, state machine, gate, proxy, logging and formatting helpers shared by the control plane, runner, harnesses and MCP server. Nothing here imports another workspace package, so it can be depended on from every layer.

## Interface

Public entry points are re-exported by `[index.ts:export *]`. Notable symbols by file:

- `[api.ts]` — wire schemas: `HarnessInfoSchema`, `JoinRequestSchema`/`JoinResponseSchema`, `HeartbeatRequestSchema`/`HeartbeatResponseSchema`, `InputAttachmentSchema`, `PendingInputSchema`, `CiFailureSchema`, `PrReviewContextSchema`, `MergeRiskSchema`, `PrReviewRequestSchema`/`PrReviewResponseSchema`, `ClaimedJobSchema`/`ClaimResponseSchema`, `EventsRequestSchema`, `StageRequestSchema`, `AskRequestSchema`/`AskResponseSchema`, `EvidenceRequestSchema`, `ConfidenceRequestSchema`, `PlanRequestSchema`, `CheckpointRequestSchema`, `OpenPrRequestSchema`/`OpenPrResponseSchema`, `GitTokenResponseSchema`, `ReadinessRequestSchema`, `OnboardingResultSchema`.
- `[brief.ts]` — `HandoffBriefSchema`, `briefRef`, `renderBrief`, `parseBrief`.
- `[comments.ts]` — `questionMarker`, `statusMarker`, `findMarker`, `renderQuestionComment`, `renderAnsweredQuestion`, `parseCheckedOption`, `parseReplyAnswer`, `renderStatusComment`, `renderPrBody`, `renderPrReviewBody`, `parseFoundryCommand`.
- `[diff.ts]` — `parseUnifiedDiff`, `diffFromGitHubFiles`, types `DiffFile`/`ParsedDiff`.
- `[events.ts]` — `EvidenceStatusSchema`, `FoundryEventSchema` discriminated union (`stage_changed`, `subagent_started`, `tool_call`, `usage`, `message`, `question`, `answer`, `evidence`, `log`, `resumed`, `gate`, `checkpoint`, `error`).
- `[gate.ts]` — `evaluateGate`, types `GateInput`, `GateFailure`, `GateResult`, `GateRuleId`.
- `[github-host.ts]` — `normalizeGitHubHost`, `githubApiUrl`, `githubGraphqlUrl`, `githubOAuthAuthorizeUrl`, `githubOAuthTokenUrl`, `githubUserInfoUrl`, `githubGitBase`, `githubIssueUrl`, `githubInstallUrl`, `resolveGitHubHostConfig`, `loadGitHubEnvFromFile`.
- `[install-script.ts]` — `installScript`, `DEFAULT_RELEASE_URL`.
- `[log.ts]` — `createLogger`, `noopLogger`, `parseLogLevel`, `isLogLevel`, `errorFields`, `newCorrelationId`, `logged`, types `Logger`/`LogFields`/`LogLevel`/`LogFormat`/`LogSink`.
- `[notify.ts]` — `notificationLine`, `buildWebhookPayload`, types `NotifyEventType`/`NotifyJob`/`WebhookPayload`.
- `[policy.ts]` — `PolicySchema`, `RiskRuleSchema`, `MergeModeSchema`, `parsePolicyYaml`, `DEFAULT_POLICY`, `effectiveMaxJobMinutes`, `effectiveMaxCostUsd`, types `Policy`/`RiskRule`/`MergeMode`.
- `[pricing.ts]` — `priceFor`, `costFromUsage`.
- `[proxy.ts]` — `DEFAULT_NO_PROXY`, `normalizeHttpProxy`, `redactProxyUrl`, `detectMacosSystemProxy`, `resolveHttpProxy`, `resolveNoProxy`, `hostMatchesNoProxy`, `shouldUseHttpProxy`, `httpProxyEnv`, `gitProxyArgs`, `applyHttpProxyEnv`, `isProxyEnvKey`, `loadHttpProxyFromEnvFile`.
- `[recipe.ts]` — `OsSchema`, `DEFAULT_UI_PATHS`, `RecipeCheckSchema`, `RecipeSchema`, `parseRecipeYaml`, `expandRecipeVars`.
- `[risk.ts]` — `matchRiskRules`, `isUiChange`, `splitReviewers`.
- `[scheduler.ts]` — `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TIMEOUT_MS`, `STICKY_WINDOW_MS`, `isOnline`, `ineligibility`, `rankRunners`, `shouldClaim`, `scheduleAllows`, `LAPTOP_DEFAULT_SCHEDULE`, `SHARED_DEFAULT_SCHEDULE`.
- `[states.ts]` — `JOB_STATUSES`, `RUNNER_STAGES`, `RUNNER_STAGE_NAMES`, `TERMINAL_STATUSES`, `RUNNING_STATUSES`, `canTransition`, `assertTransition`, `InvalidTransitionError`, `isRunnerStage`, `nextRunnerStage`, `stageLabel`, `ALL_STAGE_LABELS`, `STATUS_TITLES`, `JobKindSchema`.
- `[ticket.ts]` — `TRIGGER_LABEL`, `HARNESS_IDS`, `parseLabels`, `parseTicketSections`, `missingTicketSections`, `jobBranchName`.
- `[tokens.ts]` — `signToken`, `verifyToken`, `randomToken`, `sha256`, type `RealtimeClaims`.
- `[version.ts]` — `VERSION`.

## Invariants

- The job status graph is fixed in `[states.ts:TRANSITIONS]`: every move must pass `assertTransition`; `merged` has no outgoing edges.
- `RUNNER_STAGES` is `triage → investigating → implementing → reviewing → verifying`; `pr_review` is entered after `pr_ci`, not in sequence `[states.ts:RUNNER_STAGES][states.ts:nextRunnerStage]`.
- A status label is `foundry:<status>` with underscores replaced by hyphens; exactly one is meant to be on an issue `[states.ts:stageLabel]`.
- The confidence gate only passes when `failed.length === 0 && !pending`; the agent's confidence can lower trust but never override a failed rule `[gate.ts:evaluateGate]`.
- `changedLines` is always `additions + deletions` `[diff.ts:summarize]`.
- Proxy precedence is `FOUNDRY_HTTP_PROXY` → `HTTPS_PROXY`/`https_proxy` → `HTTP_PROXY`/`http_proxy` → caller fallback → macOS system proxy `[proxy.ts:resolveHttpProxy]`.
- Loopback hosts (`localhost`, `127.0.0.1`, `::1`) are always excluded from proxying `[proxy.ts:hostMatchesNoProxy]`.
- Logger fields named `ts`, `level`, `service`, `message` are dropped, so a caller cannot spoof the envelope `[log.ts:RESERVED]`.
- `verifyToken` compares signatures with `timingSafeEqual` and rejects expired tokens `[tokens.ts:verifyToken]`.
- `priceFor` strips a `provider/` prefix and uses the longest matching key `[pricing.ts:priceFor]`.
- Scheduling precedence: pinned runner, then a live sticky runner (exclusive), then shared runners, then least-loaded personal runner, tie-broken toward the issue author `[scheduler.ts:rankRunners]`.
- `DEFAULT_POLICY` disables merge, requires green CI, allows 3 verify loops, 2 review loops, $10 and 400 diff lines `[policy.ts:DEFAULT_POLICY]`.

## Side Effects

- `applyHttpProxyEnv` mutates the given `env` (default `process.env`) with proxy variables and logs once per process `[proxy.ts:applyHttpProxyEnv]`.
- `detectMacosSystemProxy` shells out to `scutil --proxy` (memoized) `[proxy.ts:detectMacosSystemProxy]`.
- `createLogger` writes one rendered line per record to `process.stdout` unless a `sink` is supplied `[log.ts:createLogger]`.
- `signToken`/`randomToken`/`sha256` use `node:crypto` `[tokens.ts]`.
- `loadGitHubEnvFromFile` / `loadHttpProxyFromEnvFile` fill only unset env keys.
- No other module performs network, disk or process I/O.

## Verification

- Run: `pnpm test`
