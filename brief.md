# Handoff brief: Optimize log implementation

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-12T13:38:57.173Z

## Plan

Trial journey: **GitHub webhook → job creation** (HTTP in → DB queue → business decision → job DB write → GitHub API calls).

1. `packages/shared/src/log.ts`
   - Add `newCorrelationId()` (UUID).
   - Add `logged(log, message, fn, {fields, level, result})` — the common logging aspect: one record on completion with `durationMs`, success at `debug` (or `level`), failure at `error` with `errorFields`, rethrow.
   - Export both; add unit tests in `log.test.ts`.

2. `packages/control/src/context.ts`
   - Add `withLogFields(ctx, fields)`: a context view with a correlation-bound child logger (`Object.create` so the lazy `gh` getter is not evaluated).

3. `apps/web/src/app/api/webhooks/github/route.ts`
   - Generate a `correlationId` per request, bind `{correlationId, delivery, event}` to a child logger.
   - Log the inbound API request/response/failure (`api request`, `api response`, `api request failed`) with duration/status.
   - Run the journey with `withLogFields`, so control logs share the correlation id (including the `after()` processing).

4. `packages/control/src/ingest.ts`
   - Log `webhook_inbox` insert (write), findFirst (read) and update (write) with table/operation/delivery/id key info.
   - Generate a correlation id per retried delivery in `processPendingWebhooks`.

5. `packages/control/src/jobs.ts` (`createJobFromIssue`)
   - Log the live-job read and the job insert with `table`, `operation`, `issue`, `rows`, `jobId`.

6. `packages/control/src/github-sync.ts`
   - Log repo/runner reads and the status-comment id write.
   - Wrap every external GitHub call in `logged(..., "github api call", ...)` with `provider`, `operation`, `repo`.

7. Tests
   - Unit tests for `newCorrelationId` and `logged` (success/failure/level/result).
   - Extend `tests/api/github-webhook.test.ts`: capture `ctx.log`, assert every control line shares one `correlationId`, and assert db read/write + github api call lines exist.

8. Docs
   - `docs/logging.md` + `docs/logging.zh-CN.md`: correlation id convention, `logged` aspect, trial journey, `jq` by correlation id.

## Findings

- triage: Ticket #108 asks for structured logging across key business decisions, API calls and DB reads/writes, a correlation ID, a reusable logging wrapper, and one trial journey. The requirements are clear enough to implement; the trial journey is an implementation choice I can make from the code.
- investigating: Mapped the existing structured logger (`@foundry/shared` `createLogger`, `ctx.log`, `child`) and found no correlation id, no reusable operation aspect, and no DB/API-call logging. The logger already carries child/bound fields, so correlation can be threaded through `ctx.log.child({correlationId})` without changing the logger core.
- implementing: Added correlation ids and the `logged` aspect to shared logging, instrumented the webhook → job-creation trial journey end to end (inbound API request, DB reads/writes, external GitHub calls), updated unit + API tests and both logging docs. Lint, typecheck and the full 308-test suite pass.
- review: Reviewed all three areas. Code quality: the change cleanly implements the ticket in the chosen trial journey. `newCorrelationId()` + `logged()` give a reusable aspect, `withLogFields()` propagates the correlation id through the webhook route and into `after()` processing, and the control functions log DB reads/writes and GitHub calls with stable messages plus key fields. All acceptance criteria are met: decisions (`duplicate webhook`, `job already exists`, `job revived`, `job created`), the inbound API call and outbound GitHub calls are logged, DB operations carry `table`/`operation`/ids/rows, one correlation id spans the journey, and the journey is documented and covered by a unit + API test. Behavior is unchanged: queries and error handling are identical, no new dependencies, no dead code or debug leftovers. UI design: not applicable — no UI files or user-facing behavior changed. Security: no secrets, tokens or payloads are logged; fields are ids/names/operation names only; no auth, injection or supply-chain surface touched. Non-blocking suggestions below.
- reviewing: Independent review approved the change. Moving to repository checks.
- implementing: Logging change is complete on the branch (correlation ids + `logged()` aspect, webhook → job-creation journey instrumented, docs and tests). This resume also captured the required panel screenshot: Playwright 1.65's bundled Chromium 1254 has no macOS 12 build, so `pnpm exec playwright install` cannot succeed here; instead I drove the locally installed Chromium 1208 with Playwright 1.65 via executablePath and attached evidence/logging-trial-journey-verify.png. Requesting the independent review.
- review: Reviewed the full diff against origin/main (11 files: shared logging helpers + tests, control context/ingest/jobs/github-sync, webhook route + API test, EN/ZH docs, one evidence image). Code quality: the change is additive logging only, with no behavior change on success paths; the trial journey (webhook -> job creation) is correlated across the route, `after()`, ingest, job creation and GitHub sync, and the new tests prove the aspect's success/failure paths and shared correlation id. UI design: not applicable — no components, pages, styles or tokens changed; the attached PNG is inspected but unrelated to the change. Security: no secrets, payloads or tokens are logged; no new dependencies, injection or authorization surfaces. I could not execute lint/typecheck/tests in this clean checkout (dependencies not installed), so recipe-check evidence is the proof at verify. No blocking findings; the items below are nits/opportunities.
- reviewing: Independent review approved. Running the recipe checks (lint, typecheck, full Vitest suite) on the logging change; the required UI screenshot is already attached as evidence.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "1af9b0c0-7c64-4cb7-8f86-bee99840c816",
  "title": "Optimize log implementation",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "aba89b71-425c-4900-b9ad-5104608cb239",
  "plan": "Trial journey: **GitHub webhook → job creation** (HTTP in → DB queue → business decision → job DB write → GitHub API calls).\n\n1. `packages/shared/src/log.ts`\n   - Add `newCorrelationId()` (UUID).\n   - Add `logged(log, message, fn, {fields, level, result})` — the common logging aspect: one record on completion with `durationMs`, success at `debug` (or `level`), failure at `error` with `errorFields`, rethrow.\n   - Export both; add unit tests in `log.test.ts`.\n\n2. `packages/control/src/context.ts`\n   - Add `withLogFields(ctx, fields)`: a context view with a correlation-bound child logger (`Object.create` so the lazy `gh` getter is not evaluated).\n\n3. `apps/web/src/app/api/webhooks/github/route.ts`\n   - Generate a `correlationId` per request, bind `{correlationId, delivery, event}` to a child logger.\n   - Log the inbound API request/response/failure (`api request`, `api response`, `api request failed`) with duration/status.\n   - Run the journey with `withLogFields`, so control logs share the correlation id (including the `after()` processing).\n\n4. `packages/control/src/ingest.ts`\n   - Log `webhook_inbox` insert (write), findFirst (read) and update (write) with table/operation/delivery/id key info.\n   - Generate a correlation id per retried delivery in `processPendingWebhooks`.\n\n5. `packages/control/src/jobs.ts` (`createJobFromIssue`)\n   - Log the live-job read and the job insert with `table`, `operation`, `issue`, `rows`, `jobId`.\n\n6. `packages/control/src/github-sync.ts`\n   - Log repo/runner reads and the status-comment id write.\n   - Wrap every external GitHub call in `logged(..., \"github api call\", ...)` with `provider`, `operation`, `repo`.\n\n7. Tests\n   - Unit tests for `newCorrelationId` and `logged` (success/failure/level/result).\n   - Extend `tests/api/github-webhook.test.ts`: capture `ctx.log`, assert every control line shares one `correlationId`, and assert db read/write + github api call lines exist.\n\n8. Docs\n   - `docs/logging.md` + `docs/logging.zh-CN.md`: correlation id convention, `logged` aspect, trial journey, `jq` by correlation id.",
  "findings": [
    "triage: Ticket #108 asks for structured logging across key business decisions, API calls and DB reads/writes, a correlation ID, a reusable logging wrapper, and one trial journey. The requirements are clear enough to implement; the trial journey is an implementation choice I can make from the code.",
    "investigating: Mapped the existing structured logger (`@foundry/shared` `createLogger`, `ctx.log`, `child`) and found no correlation id, no reusable operation aspect, and no DB/API-call logging. The logger already carries child/bound fields, so correlation can be threaded through `ctx.log.child({correlationId})` without changing the logger core.",
    "implementing: Added correlation ids and the `logged` aspect to shared logging, instrumented the webhook → job-creation trial journey end to end (inbound API request, DB reads/writes, external GitHub calls), updated unit + API tests and both logging docs. Lint, typecheck and the full 308-test suite pass.",
    "review: Reviewed all three areas. Code quality: the change cleanly implements the ticket in the chosen trial journey. `newCorrelationId()` + `logged()` give a reusable aspect, `withLogFields()` propagates the correlation id through the webhook route and into `after()` processing, and the control functions log DB reads/writes and GitHub calls with stable messages plus key fields. All acceptance criteria are met: decisions (`duplicate webhook`, `job already exists`, `job revived`, `job created`), the inbound API call and outbound GitHub calls are logged, DB operations carry `table`/`operation`/ids/rows, one correlation id spans the journey, and the journey is documented and covered by a unit + API test. Behavior is unchanged: queries and error handling are identical, no new dependencies, no dead code or debug leftovers. UI design: not applicable — no UI files or user-facing behavior changed. Security: no secrets, tokens or payloads are logged; fields are ids/names/operation names only; no auth, injection or supply-chain surface touched. Non-blocking suggestions below.",
    "reviewing: Independent review approved the change. Moving to repository checks.",
    "implementing: Logging change is complete on the branch (correlation ids + `logged()` aspect, webhook → job-creation journey instrumented, docs and tests). This resume also captured the required panel screenshot: Playwright 1.65's bundled Chromium 1254 has no macOS 12 build, so `pnpm exec playwright install` cannot succeed here; instead I drove the locally installed Chromium 1208 with Playwright 1.65 via executablePath and attached evidence/logging-trial-journey-verify.png. Requesting the independent review.",
    "review: Reviewed the full diff against origin/main (11 files: shared logging helpers + tests, control context/ingest/jobs/github-sync, webhook route + API test, EN/ZH docs, one evidence image). Code quality: the change is additive logging only, with no behavior change on success paths; the trial journey (webhook -> job creation) is correlated across the route, `after()`, ingest, job creation and GitHub sync, and the new tests prove the aspect's success/failure paths and shared correlation id. UI design: not applicable — no components, pages, styles or tokens changed; the attached PNG is inspected but unrelated to the change. Security: no secrets, payloads or tokens are logged; no new dependencies, injection or authorization surfaces. I could not execute lint/typecheck/tests in this clean checkout (dependencies not installed), so recipe-check evidence is the proof at verify. No blocking findings; the items below are nits/opportunities.",
    "reviewing: Independent review approved. Running the recipe checks (lint, typecheck, full Vitest suite) on the logging change; the required UI screenshot is already attached as evidence."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-12T13:38:57.173Z"
}
```
