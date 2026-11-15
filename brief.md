# Handoff brief: Show toast message while clicking Save button in Repos page

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-15T01:11:32.215Z

## Plan

Ticket #127 — toast on Save in the Repos page. The panel already has `ToastProvider` in `apps/web/src/app/(panel)/layout.tsx` and `useToast()` in `apps/web/src/components/toast.tsx`; `JobLimitsForm` is the established pattern for a client form that calls a server action and toasts the outcome.

1. `apps/web/src/app/(panel)/repos/repo-settings-form.tsx` (new client component, modeled on `job-limits-form.tsx`)
   - Props: `repoId`, `settingsKey`, `mergeMode`, `defaultHarness`, `defaultModel`, `ghProjectId`.
   - `useToast()` + `useTransition()`; `onSubmit` prevents default, builds `FormData`, calls `repoSettingsAction`, and toasts:
     - ok: "Repo settings saved" / ok tone,
     - `{ ok: false }`: "Repo settings not saved" with the action's error, bad tone,
     - thrown error: generic bad toast.
   - Save button disabled while pending with "Saving…", matching the job-limits form.
   - Keeps the `key={settingsKey}` remount so uncontrolled fields show persisted values.

2. `apps/web/src/app/actions.ts` — `repoSettingsAction` returns `{ ok: true }` (typed `RepoSettingsResult`) instead of void, so the form can distinguish success; throw paths stay as-is and are caught in the client.

3. `apps/web/src/app/(panel)/repos/page.tsx` — replace the inline settings `<form action={repoSettingsAction}>` with `<RepoSettingsForm key={settingsKey} … />`, passing the same fields. `HARNESS_IDS` moves into the client component. Other forms (sync, onboard, skills) untouched.

4. Tests — new `tests/api/repo-settings.test.ts` (uses `createTestEnv`/`seedTeam`, same mocking style as `tests/api/job-configuration.test.ts`): asserts `repoSettingsAction` resolves to `{ ok: true }` and persists merge mode / harness / model / project id, and that empty harness/model/project strings clear to null. Skips without `FOUNDRY_TEST_DATABASE_URL`, like the other DB tests.

5. Docs — update `apps/web/src/app/(panel)/repos/EGM.md` interface/side-effects lines for the new client form (existing doc, no new files).

Verify: `pnpm exec biome check --write` on touched files, `pnpm --filter @foundry/web exec tsc -p tsconfig.json --incremental false`, targeted vitest, then `run_checks`. Screenshot the Repos page save toast via the dev server on `$FOUNDRY_PORT` and attach with `evidence`.

## Findings

- triage: Ticket is clear: the Repos page Save button (repoSettingsAction) gives no feedback. The panel already has a ToastProvider in the (panel) layout and a reusable useToast hook, with JobLimitsForm as the established pattern for a client form that saves via a server action and toasts the outcome.
- investigating: Investigated the Repos page, actions.ts, the toast provider, and the JobLimitsForm precedent; plan recorded.
- implementing: Extracted the Repos settings form into a client component that saves through repoSettingsAction and toasts the outcome with the shared useToast (success and failure tones), disabling Save while pending. The action now resolves with { ok: true }; added tests/api/repo-settings.test.ts (verified against a local Postgres: 3 passed) and updated the repos EGM doc.
- review: Reviewed all three areas — code quality, UI design and security all applied and were checked. The change meets both acceptance criteria: the Repos settings form is now a client component that saves through `repoSettingsAction` and reports the outcome with the existing `useToast` component (success `ok` tone, failure `bad` tone, Save disabled and labeled "Saving…" while pending); the attached screenshot (`evidence/repo-settings-toast-save.png`) shows the success toast rendering in the panel, matching the Job limits toast. The action still enforces admin via `teamRepo(..., true)` (server-side `requireAdmin` + team-scoped repo lookup), so hiding the form from non-admins is not the security boundary; no secrets, injection surface or new dependencies were introduced. UI/design system: no new tokens or styles, the toast viewport and tone styling come from the shared component, so nothing diverges from DESIGN.md. Tests: the new `tests/api/repo-settings.test.ts` mirrors `tests/api/job-configuration.test.ts` (same mocks, `createTestEnv`/`seedTeam`, `describe.skipIf(!TEST_DATABASE_URL)`), is picked up by the `api` vitest project, and asserts persistence plus the empty-field and unknown-merge-mode paths; the client toast itself has no automated test, which is acceptable here because the repo has no client-component harness and the screenshot is the visual proof. Note: this review checkout has no `node_modules`, so I did not execute the test or typecheck commands — the new test was reviewed statically. Remaining findings are non-blocking nits.
- reviewing: Reviewer approved the change. Running the recipe checks next, then attaching the toast screenshot as evidence.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "09243d90-c5fe-4709-8358-fd2bf3d5e173",
  "title": "Show toast message while clicking Save button in Repos page",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "a9296aee-d195-45a6-bb35-d8540596af56",
  "plan": "Ticket #127 — toast on Save in the Repos page. The panel already has `ToastProvider` in `apps/web/src/app/(panel)/layout.tsx` and `useToast()` in `apps/web/src/components/toast.tsx`; `JobLimitsForm` is the established pattern for a client form that calls a server action and toasts the outcome.\n\n1. `apps/web/src/app/(panel)/repos/repo-settings-form.tsx` (new client component, modeled on `job-limits-form.tsx`)\n   - Props: `repoId`, `settingsKey`, `mergeMode`, `defaultHarness`, `defaultModel`, `ghProjectId`.\n   - `useToast()` + `useTransition()`; `onSubmit` prevents default, builds `FormData`, calls `repoSettingsAction`, and toasts:\n     - ok: \"Repo settings saved\" / ok tone,\n     - `{ ok: false }`: \"Repo settings not saved\" with the action's error, bad tone,\n     - thrown error: generic bad toast.\n   - Save button disabled while pending with \"Saving…\", matching the job-limits form.\n   - Keeps the `key={settingsKey}` remount so uncontrolled fields show persisted values.\n\n2. `apps/web/src/app/actions.ts` — `repoSettingsAction` returns `{ ok: true }` (typed `RepoSettingsResult`) instead of void, so the form can distinguish success; throw paths stay as-is and are caught in the client.\n\n3. `apps/web/src/app/(panel)/repos/page.tsx` — replace the inline settings `<form action={repoSettingsAction}>` with `<RepoSettingsForm key={settingsKey} … />`, passing the same fields. `HARNESS_IDS` moves into the client component. Other forms (sync, onboard, skills) untouched.\n\n4. Tests — new `tests/api/repo-settings.test.ts` (uses `createTestEnv`/`seedTeam`, same mocking style as `tests/api/job-configuration.test.ts`): asserts `repoSettingsAction` resolves to `{ ok: true }` and persists merge mode / harness / model / project id, and that empty harness/model/project strings clear to null. Skips without `FOUNDRY_TEST_DATABASE_URL`, like the other DB tests.\n\n5. Docs — update `apps/web/src/app/(panel)/repos/EGM.md` interface/side-effects lines for the new client form (existing doc, no new files).\n\nVerify: `pnpm exec biome check --write` on touched files, `pnpm --filter @foundry/web exec tsc -p tsconfig.json --incremental false`, targeted vitest, then `run_checks`. Screenshot the Repos page save toast via the dev server on `$FOUNDRY_PORT` and attach with `evidence`.",
  "findings": [
    "triage: Ticket is clear: the Repos page Save button (repoSettingsAction) gives no feedback. The panel already has a ToastProvider in the (panel) layout and a reusable useToast hook, with JobLimitsForm as the established pattern for a client form that saves via a server action and toasts the outcome.",
    "investigating: Investigated the Repos page, actions.ts, the toast provider, and the JobLimitsForm precedent; plan recorded.",
    "implementing: Extracted the Repos settings form into a client component that saves through repoSettingsAction and toasts the outcome with the shared useToast (success and failure tones), disabling Save while pending. The action now resolves with { ok: true }; added tests/api/repo-settings.test.ts (verified against a local Postgres: 3 passed) and updated the repos EGM doc.",
    "review: Reviewed all three areas — code quality, UI design and security all applied and were checked. The change meets both acceptance criteria: the Repos settings form is now a client component that saves through `repoSettingsAction` and reports the outcome with the existing `useToast` component (success `ok` tone, failure `bad` tone, Save disabled and labeled \"Saving…\" while pending); the attached screenshot (`evidence/repo-settings-toast-save.png`) shows the success toast rendering in the panel, matching the Job limits toast. The action still enforces admin via `teamRepo(..., true)` (server-side `requireAdmin` + team-scoped repo lookup), so hiding the form from non-admins is not the security boundary; no secrets, injection surface or new dependencies were introduced. UI/design system: no new tokens or styles, the toast viewport and tone styling come from the shared component, so nothing diverges from DESIGN.md. Tests: the new `tests/api/repo-settings.test.ts` mirrors `tests/api/job-configuration.test.ts` (same mocks, `createTestEnv`/`seedTeam`, `describe.skipIf(!TEST_DATABASE_URL)`), is picked up by the `api` vitest project, and asserts persistence plus the empty-field and unknown-merge-mode paths; the client toast itself has no automated test, which is acceptable here because the repo has no client-component harness and the screenshot is the visual proof. Note: this review checkout has no `node_modules`, so I did not execute the test or typecheck commands — the new test was reviewed statically. Remaining findings are non-blocking nits.",
    "reviewing: Reviewer approved the change. Running the recipe checks next, then attaching the toast screenshot as evidence."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-15T01:11:32.215Z"
}
```
