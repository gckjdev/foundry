# Handoff brief: Fail ticket jobs when recipe checks still fail after max verify loops

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T05:43:43.994Z

## Plan

1. Add a FakeHarness test in `apps/runner/src/job-runner.test.ts`: four turns that keep calling `stage(done)` with the `done.txt` check failing, using the default `max_verify_loops: 3`. Assert outcome `"failed"`, no `openPr` call, and the failure reason names the `marker` check plus the loop count.
2. In `apps/runner/src/job-runner.ts` `finishTicket`, replace the "opening the PR anyway" warning with `throw new FailJob(...)` when `retryOrGiveUp` returns null, naming the failed checks and `this.loop`.
3. Run `pnpm exec biome check` on touched files and the runner test suite.

## Findings

- triage: Ticket is clear and buildable: when recipe checks still fail after max_verify_loops in finishTicket, the job must fail instead of opening a PR. Acceptance criteria name the file, function and expected test behavior.
- investigating: Added the failing test first, then replaced the finishTicket warning-and-open-PR fallback with a FailJob that names the failing checks and loop count. Onboarding path untouched.
- implementing: Implementation complete; running the recipe checks and the targeted runner suite now.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "7ea88361-27c6-47fe-b785-2c4d29242c8e",
  "title": "Fail ticket jobs when recipe checks still fail after max verify loops",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "be2c9a2c-7903-482f-ad6d-203c2b4a480d",
  "plan": "1. Add a FakeHarness test in `apps/runner/src/job-runner.test.ts`: four turns that keep calling `stage(done)` with the `done.txt` check failing, using the default `max_verify_loops: 3`. Assert outcome `\"failed\"`, no `openPr` call, and the failure reason names the `marker` check plus the loop count.\n2. In `apps/runner/src/job-runner.ts` `finishTicket`, replace the \"opening the PR anyway\" warning with `throw new FailJob(...)` when `retryOrGiveUp` returns null, naming the failed checks and `this.loop`.\n3. Run `pnpm exec biome check` on touched files and the runner test suite.",
  "findings": [
    "triage: Ticket is clear and buildable: when recipe checks still fail after max_verify_loops in finishTicket, the job must fail instead of opening a PR. Acceptance criteria name the file, function and expected test behavior.",
    "investigating: Added the failing test first, then replaced the finishTicket warning-and-open-PR fallback with a FailJob that names the failing checks and loop count. Onboarding path untouched.",
    "implementing: Implementation complete; running the recipe checks and the targeted runner suite now."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T05:43:43.994Z"
}
```
