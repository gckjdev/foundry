# Handoff brief: Capture a screenshot in verifying when a UI change has none

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T08:59:00.275Z

## Plan

1. checks.ts: add startCommand (detached process group, exitCode/output/stop).
2. job-runner.ts: track screenshotAttached; captureUiScreenshot(recipe) starts recipe.dev_server with expandRecipeVars, waits for 2xx on $FOUNDRY_PORT$ready_path, captures .foundry-local/verify.png via npx playwright (injectable for tests), records it through toolEvidence, kills the process group in finally. Fail when no dev_server. Call from finishTicket and finishOnboarding on UI diffs only.
3. job-runner.test.ts: UI fixture with node:http dev_server -> pr_opened + screenshot evidence; UI change without dev_server -> failed, no PR.
4. Verify biome, runner typecheck, targeted vitest.

## Findings

- investigating: Plan recorded. Implementing the dev-server/screenshot capture in the runner, wiring it into finishTicket and finishOnboarding, and adding the two FakeHarness tests.
- implementing: Implemented verifying-time screenshot capture: `startCommand` for a killed-by-group dev server, `captureUiScreenshot` (dev_server required, expandRecipeVars, 2xx readiness poll, `.foundry-local/verify.png` via npx Playwright with injectable test seam, recorded through toolEvidence, process group killed in finally), wired into finishTicket and finishOnboarding for UI diffs only. Added three tests: auto-capture, agent-already-attached, and missing dev_server. Targeted runner tests, biome and runner typecheck pass.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "3ff8f9da-3f11-4b62-bb76-2512c74edd9b",
  "title": "Capture a screenshot in verifying when a UI change has none",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "fa84b982-4c19-4159-b3ad-346942f1d027",
  "plan": "1. checks.ts: add startCommand (detached process group, exitCode/output/stop).\n2. job-runner.ts: track screenshotAttached; captureUiScreenshot(recipe) starts recipe.dev_server with expandRecipeVars, waits for 2xx on $FOUNDRY_PORT$ready_path, captures .foundry-local/verify.png via npx playwright (injectable for tests), records it through toolEvidence, kills the process group in finally. Fail when no dev_server. Call from finishTicket and finishOnboarding on UI diffs only.\n3. job-runner.test.ts: UI fixture with node:http dev_server -> pr_opened + screenshot evidence; UI change without dev_server -> failed, no PR.\n4. Verify biome, runner typecheck, targeted vitest.",
  "findings": [
    "investigating: Plan recorded. Implementing the dev-server/screenshot capture in the runner, wiring it into finishTicket and finishOnboarding, and adding the two FakeHarness tests.",
    "implementing: Implemented verifying-time screenshot capture: `startCommand` for a killed-by-group dev server, `captureUiScreenshot` (dev_server required, expandRecipeVars, 2xx readiness poll, `.foundry-local/verify.png` via npx Playwright with injectable test seam, recorded through toolEvidence, process group killed in finally), wired into finishTicket and finishOnboarding for UI diffs only. Added three tests: auto-capture, agent-already-attached, and missing dev_server. Targeted runner tests, biome and runner typecheck pass."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T08:59:00.275Z"
}
```
