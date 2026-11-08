# Handoff brief: Wire FakeHarness e2e coverage for auto-merge, ask, and portable resume

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T06:04:22.875Z

## Plan

## Plan

1. **`tests/e2e/pipeline.test.ts`** — new file, `describe.skipIf(!TEST_DATABASE_URL)`, reuses `createE2E`, `FakeHarness`, `agentTools`, `labeledIssue`, `checkSuiteCompleted`, `waitFor`.
   - Shared helpers: `writeFile`, `shaOf(cwd)` (git rev-parse HEAD), `offline(world, runnerId)` (set `lastSeenAt` to epoch), and a policy/recipe with `merge: merge_when_confident` + a single always-passing check (`run: "true"`) so readiness and verify both pass without running this repo's real checks.
   - The agent turn records pending CI against the checkpointed HEAD (`gh.repo("acme/app").ci.set(sha,"pending")`) after the verifying checkpoint, so `openPullRequest` parks at `pr_ci` until the green `check_suite` webhook arrives.

2. **Scenario 1 auto-merge** — start one FakeHarness runner; walk stages, write `done.txt`, confidence high, done. Wait for `pr_ci` + headSha, mark fake CI success, deliver `check_suite` completed → assert status `merged` and PR merged.

3. **Scenario 2 ask** — first turn calls `ask` with two options; assert job `needs_input` and the question comment; edit the comment to tick A, deliver `issue_comment` edited; assert queued, call `daemon.claimLoop()`, second turn finishes → assert PR opened (`prNumber` non-null, status `waiting_on_you` with merge off).

4. **Scenario 3 risk-rule handover** — policy `merge_when_confident` + risk rule on `db/migrations/**` reviewer `carol`; write a migration file, green CI → assert `waiting_on_you`, `assignedReviewers` includes `carol`, PR not merged.

5. **Scenarios 4/5 portable resume** (raise `timeout` to 60s: two runner start/stop cycles plus a git checkpoint/brief fetch) — first macos runner reaches `implementing` and blocks; wait for its checkpoint, set its `lastSeenAt` to the past, `requeueLostJobs`; second runner claims. Scenario 4: second macos runner; scenario 5: recipe allows `[macos, linux]`, second runner linux. Assert the `resumed` event has `mode: "portable"`, the second harness prompt contains the first runner's plan (brief), and the job completes on the second runner.

6. **Verify** — `pnpm exec biome check --write tests/e2e/pipeline.test.ts`, `pnpm exec vitest run tests/e2e/pipeline.test.ts` with `FOUNDRY_TEST_DATABASE_URL`, plus typecheck of the test.

## Findings

- triage: The ticket is clear. I traced tests/e2e/harness.ts (createE2E: real control plane + Daemon + GitBackedGitHub), FakeHarness/agentTools, JobRunner's stage/ask/finish flow, the confidence gate, risk rules, and the sweeper/claim resume modes. The scenarios map cleanly onto existing helpers without rewriting harness.ts.
- investigating: Writing tests/e2e/pipeline.test.ts with the five scenarios, reusing createE2E/FakeHarness and extending only the test file (no harness.ts rewrite).
- implementing: Added tests/e2e/pipeline.test.ts with the five pipeline scenarios. The file passes locally against the test database (5/5) and full typecheck is green. Running the recipe checks now.
- implementing: Fixed the CI flake in scenario 3: risk-rule jobs can hand over to waiting_on_you at PR-open time (openPullRequest evaluates the gate), so waiting only for the transient pr_ci raced on slower CI runners. deliverGreenCi now accepts the possible settled statuses, and the risk scenario waits for pr_ci or waiting_on_you before sending the green webhook. Pipeline file passes 3/3 consecutive runs locally under Node 22 against the test DB.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "07081a29-ce2b-44b4-be8c-d9edbdf899cc",
  "title": "Wire FakeHarness e2e coverage for auto-merge, ask, and portable resume",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "00b73d42-7a3b-45da-a1fd-a2d9123cf78f",
  "plan": "## Plan\n\n1. **`tests/e2e/pipeline.test.ts`** — new file, `describe.skipIf(!TEST_DATABASE_URL)`, reuses `createE2E`, `FakeHarness`, `agentTools`, `labeledIssue`, `checkSuiteCompleted`, `waitFor`.\n   - Shared helpers: `writeFile`, `shaOf(cwd)` (git rev-parse HEAD), `offline(world, runnerId)` (set `lastSeenAt` to epoch), and a policy/recipe with `merge: merge_when_confident` + a single always-passing check (`run: \"true\"`) so readiness and verify both pass without running this repo's real checks.\n   - The agent turn records pending CI against the checkpointed HEAD (`gh.repo(\"acme/app\").ci.set(sha,\"pending\")`) after the verifying checkpoint, so `openPullRequest` parks at `pr_ci` until the green `check_suite` webhook arrives.\n\n2. **Scenario 1 auto-merge** — start one FakeHarness runner; walk stages, write `done.txt`, confidence high, done. Wait for `pr_ci` + headSha, mark fake CI success, deliver `check_suite` completed → assert status `merged` and PR merged.\n\n3. **Scenario 2 ask** — first turn calls `ask` with two options; assert job `needs_input` and the question comment; edit the comment to tick A, deliver `issue_comment` edited; assert queued, call `daemon.claimLoop()`, second turn finishes → assert PR opened (`prNumber` non-null, status `waiting_on_you` with merge off).\n\n4. **Scenario 3 risk-rule handover** — policy `merge_when_confident` + risk rule on `db/migrations/**` reviewer `carol`; write a migration file, green CI → assert `waiting_on_you`, `assignedReviewers` includes `carol`, PR not merged.\n\n5. **Scenarios 4/5 portable resume** (raise `timeout` to 60s: two runner start/stop cycles plus a git checkpoint/brief fetch) — first macos runner reaches `implementing` and blocks; wait for its checkpoint, set its `lastSeenAt` to the past, `requeueLostJobs`; second runner claims. Scenario 4: second macos runner; scenario 5: recipe allows `[macos, linux]`, second runner linux. Assert the `resumed` event has `mode: \"portable\"`, the second harness prompt contains the first runner's plan (brief), and the job completes on the second runner.\n\n6. **Verify** — `pnpm exec biome check --write tests/e2e/pipeline.test.ts`, `pnpm exec vitest run tests/e2e/pipeline.test.ts` with `FOUNDRY_TEST_DATABASE_URL`, plus typecheck of the test.",
  "findings": [
    "triage: The ticket is clear. I traced tests/e2e/harness.ts (createE2E: real control plane + Daemon + GitBackedGitHub), FakeHarness/agentTools, JobRunner's stage/ask/finish flow, the confidence gate, risk rules, and the sweeper/claim resume modes. The scenarios map cleanly onto existing helpers without rewriting harness.ts.",
    "investigating: Writing tests/e2e/pipeline.test.ts with the five scenarios, reusing createE2E/FakeHarness and extending only the test file (no harness.ts rewrite).",
    "implementing: Added tests/e2e/pipeline.test.ts with the five pipeline scenarios. The file passes locally against the test database (5/5) and full typecheck is green. Running the recipe checks now.",
    "implementing: Fixed the CI flake in scenario 3: risk-rule jobs can hand over to waiting_on_you at PR-open time (openPullRequest evaluates the gate), so waiting only for the transient pr_ci raced on slower CI runners. deliverGreenCi now accepts the possible settled statuses, and the risk scenario waits for pr_ci or waiting_on_you before sending the green webhook. Pipeline file passes 3/3 consecutive runs locally under Node 22 against the test DB."
  ],
  "checks": [
    {
      "name": "lint",
      "status": "passed"
    },
    {
      "name": "typecheck",
      "status": "passed"
    },
    {
      "name": "test",
      "status": "passed"
    }
  ],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T06:04:22.875Z"
}
```
