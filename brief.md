# Handoff brief: Fix bug: not able to choose opencode for repo

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T06:47:39.102Z

## Plan

1. Root cause (confirmed against the running app): `repoSettingsAction` persists `defaultHarness` correctly (verified in Postgres), but React 19 resets uncontrolled form fields after a function `action` completes. The `<select defaultValue={repo.defaultHarness}>` in `apps/web/src/app/(panel)/repos/page.tsx` is uncontrolled, so after save the DOM resets to the defaultValue from the original render (`claude-code`) and never picks up the server's new value. A full page reload shows `opencode`.
2. Fix: re-key the repo settings `<form>` on the persisted settings (mergeMode, defaultHarness, defaultModel, ghProjectId) in `apps/web/src/app/(panel)/repos/page.tsx`, so after a successful save the fields remount with the values the action just wrote. Smallest change; no new client component.
3. No automated test added: the panel page is an async Next server component gated by Auth.js + Postgres, and the repo has no component-test harness (Playwright only covers /signin). Verified instead in a real browser (Playwright) against a worktree dev server backed by a throwaway Postgres clone: claude-code -> opencode -> save shows opencode, toggling both ways works, and the value survives a reload. Screenshot attached.
4. Run recipe checks (lint, typecheck, vitest) via run_checks and fix any failures.

## Findings

- triage: Ticket is clear: on the repo page, saving harness "opencode" reverts to "claude-code". Acceptance criterion is that the saved harness is displayed after save. No ambiguity requiring a product decision.
- investigating: Root-caused the revert to React 19 resetting uncontrolled form fields after a server action: the DB keeps opencode, but the uncontrolled <select> resets to the stale defaultValue. Applied a form-level key keyed on the persisted repo settings so the fields remount with the saved values.
- implementing: Implemented the form re-key fix and verified it in a real browser against a worktree dev server on an isolated Postgres: selecting opencode and saving now keeps opencode visible, toggling back to claude-code works, and the value persists after reload. Lint and web typecheck on the touched file pass.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "52027e72-3032-4c8c-a792-193c8858c7bc",
  "title": "Fix bug: not able to choose opencode for repo",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "1b987674-bc5b-4c27-8beb-341f73b05e60",
  "plan": "1. Root cause (confirmed against the running app): `repoSettingsAction` persists `defaultHarness` correctly (verified in Postgres), but React 19 resets uncontrolled form fields after a function `action` completes. The `<select defaultValue={repo.defaultHarness}>` in `apps/web/src/app/(panel)/repos/page.tsx` is uncontrolled, so after save the DOM resets to the defaultValue from the original render (`claude-code`) and never picks up the server's new value. A full page reload shows `opencode`.\n2. Fix: re-key the repo settings `<form>` on the persisted settings (mergeMode, defaultHarness, defaultModel, ghProjectId) in `apps/web/src/app/(panel)/repos/page.tsx`, so after a successful save the fields remount with the values the action just wrote. Smallest change; no new client component.\n3. No automated test added: the panel page is an async Next server component gated by Auth.js + Postgres, and the repo has no component-test harness (Playwright only covers /signin). Verified instead in a real browser (Playwright) against a worktree dev server backed by a throwaway Postgres clone: claude-code -> opencode -> save shows opencode, toggling both ways works, and the value survives a reload. Screenshot attached.\n4. Run recipe checks (lint, typecheck, vitest) via run_checks and fix any failures.",
  "findings": [
    "triage: Ticket is clear: on the repo page, saving harness \"opencode\" reverts to \"claude-code\". Acceptance criterion is that the saved harness is displayed after save. No ambiguity requiring a product decision.",
    "investigating: Root-caused the revert to React 19 resetting uncontrolled form fields after a server action: the DB keeps opencode, but the uncontrolled <select> resets to the stale defaultValue. Applied a form-level key keyed on the persisted repo settings so the fields remount with the saved values.",
    "implementing: Implemented the form re-key fix and verified it in a real browser against a worktree dev server on an isolated Postgres: selecting opencode and saving now keeps opencode visible, toggling back to claude-code works, and the value persists after reload. Lint and web typecheck on the touched file pass."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T06:47:39.102Z"
}
```
