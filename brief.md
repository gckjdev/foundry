# Handoff brief: Add a common toast message and apply in job configuration page

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-14T13:42:16.485Z

## Plan

1. Add `apps/web/src/components/toast.tsx` — a client `ToastProvider` + `useToast()` API rendering a fixed viewport of toasts (tone ok/warn/bad/info, auto-dismiss, pause on hover/focus, manual dismiss, `role="status"`).
2. Add `.toasts` / `.toast` styles to `apps/web/src/app/globals.css` using existing tokens (raised surface, 1px semantic border, 6px radius, quiet fade-in) and mirror the spec in `DESIGN.md`.
3. Wrap the panel layout (`apps/web/src/app/(panel)/layout.tsx`) in `ToastProvider`.
4. Change `jobLimitsAction` in `apps/web/src/app/actions.ts` to return `JobLimitsResult` (`{ok:true}` / `{ok:false,error}`) like `messageAction`, with messages for invalid minutes/cost.
5. Extract the Job limits form into `configuration/job-limits-form.tsx` (client): `useTransition`, submit via `jobLimitsAction`, show success/error toast, disable Save while pending.
6. Wire the page to the new form; keep `key={limitsKey}` so defaults refresh after save.
7. Extend `tests/api/job-configuration.test.ts` to assert the returned result (success and invalid input) without changing the persisted-value coverage.
8. Verify: biome, typecheck, targeted + full tests, then run the panel on $FOUNDRY_PORT and screenshot the toast after Save.

## Findings

- triage: The job configuration page renders a server-component form posting to jobLimitsAction, which currently returns void and silently drops invalid input. The panel has no toast system and uses useTransition-based client components. Design tokens live in DESIGN.md and globals.css.
- investigating: Investigation complete: the page is `jobs/[id]/configuration/page.tsx`, the save action is `jobLimitsAction` in `app/actions.ts`, and the panel client boundary is `PanelShell` under `(panel)/layout.tsx`. Tests exercise the action against a real DB.
- implementing: Added a reusable toast system (`ToastProvider`/`useToast` + viewport styles in globals.css, documented in DESIGN.md), mounted it in the panel layout, and wired the Job limits form to report success/error via toast. `jobLimitsAction` now returns a result instead of silently voiding invalid input, and API tests assert both outcomes. Verified Save in the browser on $FOUNDRY_PORT: success toast renders bottom-right.
- review: Both acceptance criteria are met: a reusable toast system (`apps/web/src/components/toast.tsx`, mounted once in `(panel)/layout.tsx`) exists, and the Job limits Save path reports success and failure through it. `jobLimitsAction` now returns `JobLimitsResult` instead of silently voiding invalid input, which is a genuine improvement, and the API test asserts both outcomes. I checked code quality, UI design and security. Code quality: the extracted client form keeps `key={limitsKey}` so defaults refresh after save, the async `startTransition` pattern matches `message-composer.tsx`, and no other callers of `jobLimitsAction` exist. UI design: colors, radius, type and tone usage map onto existing tokens (`--bg-raised`, `--radius`, 13px/12px text, `--ok/--warn/--bad/--steel`) and DESIGN.md documents the component; nits below concern padding and live-region announcement. Security: no new input boundary, no secrets, error strings are static and React escapes them; authorization still flows through `teamJob`. I could not execute typecheck or the Vitest suite in this review worktree (no `node_modules` installed) — Biome check on all touched files passes and I verified types by reading. No blocking findings.
- reviewing: Reviewer approved. Moving to recipe checks and UI evidence for the toast on the job configuration Save flow.
- implementing: Fixed the Auto PR Review non-blocking findings: `.toast` padding now matches DESIGN.md (12px), the live region moved to the persistent `.toasts` container (`aria-live="polite"`, `aria-atomic="false"`, semantic ul/li so the Dismiss button is not inside a `role="status"` region), and the invalid-cost error message is now asserted. The fourth item (component tests for the toast) needs no change: the repo has no DOM/component test project and the reviewer itself noted the UI screenshot is the current proof. Biome, DESIGN.md lint, full recipe checks and the 5-case DB test pass; a fresh screenshot proves the Save toast still renders.
- review: Both acceptance criteria are met. The common toast lives in `apps/web/src/components/toast.tsx` (context provider + `useToast()`, tones, 5s auto-dismiss, pause on hover/focus, persistent `aria-live="polite"` viewport, max 3), is documented in DESIGN.md and styled with existing tokens (`--bg-raised`, `--radius`, semantic colors, `--text-dim`), and the provider wraps the panel so any page can use it. The Job limits form now calls `jobLimitsAction` via `useTransition` and shows success/error toasts; the action returns a typed result instead of silently returning, and the DB test asserts both success and both validation errors (including the cost message). The `key={limitsKey}` remount still refreshes defaults after a revalidated save, and the screenshot `evidence/job-config-toast-save.png` shows the toast rendering bottom-right in the saved state.

Areas checked: code quality (correctness, acceptance criteria, tests, scope, maintainability) — applies; UI design — applies and is consistent with DESIGN.md (surface/radius/padding/type, semantic-tone title and border only, reduced-motion fallback, responsive width); security — checked and applies cleanly (no new input surface, `teamJob` team scoping unchanged, static error strings, no secrets). Note that the toast component's render/dismiss behavior has no automated test (the repo has only node-environment unit/api projects, no DOM project), so the screenshot is the proof for that layer; the action-level success and failure paths are covered.

Non-blocking nits only: the client save handler swallows the thrown error without logging, the DESIGN.md "never take focus" wording conflicts with the (correctly) focusable Dismiss button, and `JobLimitsResult` duplicates the identical `MessageResult` shape.
- reviewing: Reviewer approved the non-blocking fixes. Proceeding to re-run the recipe checks and report confidence.
- implementing: The toast implementation is complete on this branch: reusable ToastProvider/useToast mounted in the panel layout, job limits Save reports success and validation errors via toast, and API tests assert both action outcomes. Recipe checks pass and the Save success toast is captured in evidence/job-config-toast-save.png. Requesting the independent review against the current HEAD.
- review: Reviewed the full diff against origin/main (toast.tsx, panel layout, job-limits-form.tsx, configuration page, actions.ts, globals.css, DESIGN.md, API tests, evidence).

Acceptance criteria both met: a reusable `ToastProvider`/`useToast` is mounted once in the panel layout (apps/web/src/app/(panel)/layout.tsx), and the Job configuration Save button now reports both outcomes as toasts — success (`tone: "ok"`) and validation failure (`tone: "bad"` with the action's message). `jobLimitsAction` now returns a `JobLimitsResult`, following the existing `messageAction` pattern; its only caller was updated. Auth scoping is unchanged (`teamJob` still checks job.teamId against the session team), and the client catch path shows a generic message without leaking internals.

Code quality: correct and small. The `key={limitsKey}` remount still refreshes defaults after a save (Next applies `revalidatePath` even when a server action is invoked directly from a transition, as message-composer already relies on), and the pending guard/disabled button prevent double submits. Tests assert `{ok:true}` plus both validation failures, and DB tests run in the recipe because the runner exports FOUNDRY_TEST_DATABASE_URL.

UI design: checked against DESIGN.md — `colors.surface` = --bg-raised, radius 6px = rounded.sm, 12px padding, body-md title at 500, body-sm description, bottom-right stack, 5s auto-dismiss with hover/focus pause, persistent aria-live="polite" region, 200ms/6px enter animation suppressed under prefers-reduced-motion. The attached screenshot shows the success toast rendering correctly above the page grain (z-index 200 > 100) with the green title and dismiss control. The toast component's runtime behavior (auto-dismiss, cap, pause) is not unit-tested, but the repo has no component-test harness and the screenshot is the required UI proof.

Security: no security-relevant code changed; no secrets, injection, or new authorization surface. Only minor nits are listed below.
- reviewing: Independent review approved the current HEAD. Starting final verification: recipe checks, screenshot evidence, then confidence.

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
  "jobId": "188cd67c-aa9b-4a20-a878-4d82e53824fa",
  "title": "Add a common toast message and apply in job configuration page",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "046c0ad4-6e40-423f-b534-fe7b4d4c4ed3",
  "plan": "1. Add `apps/web/src/components/toast.tsx` — a client `ToastProvider` + `useToast()` API rendering a fixed viewport of toasts (tone ok/warn/bad/info, auto-dismiss, pause on hover/focus, manual dismiss, `role=\"status\"`).\n2. Add `.toasts` / `.toast` styles to `apps/web/src/app/globals.css` using existing tokens (raised surface, 1px semantic border, 6px radius, quiet fade-in) and mirror the spec in `DESIGN.md`.\n3. Wrap the panel layout (`apps/web/src/app/(panel)/layout.tsx`) in `ToastProvider`.\n4. Change `jobLimitsAction` in `apps/web/src/app/actions.ts` to return `JobLimitsResult` (`{ok:true}` / `{ok:false,error}`) like `messageAction`, with messages for invalid minutes/cost.\n5. Extract the Job limits form into `configuration/job-limits-form.tsx` (client): `useTransition`, submit via `jobLimitsAction`, show success/error toast, disable Save while pending.\n6. Wire the page to the new form; keep `key={limitsKey}` so defaults refresh after save.\n7. Extend `tests/api/job-configuration.test.ts` to assert the returned result (success and invalid input) without changing the persisted-value coverage.\n8. Verify: biome, typecheck, targeted + full tests, then run the panel on $FOUNDRY_PORT and screenshot the toast after Save.",
  "findings": [
    "triage: The job configuration page renders a server-component form posting to jobLimitsAction, which currently returns void and silently drops invalid input. The panel has no toast system and uses useTransition-based client components. Design tokens live in DESIGN.md and globals.css.",
    "investigating: Investigation complete: the page is `jobs/[id]/configuration/page.tsx`, the save action is `jobLimitsAction` in `app/actions.ts`, and the panel client boundary is `PanelShell` under `(panel)/layout.tsx`. Tests exercise the action against a real DB.",
    "implementing: Added a reusable toast system (`ToastProvider`/`useToast` + viewport styles in globals.css, documented in DESIGN.md), mounted it in the panel layout, and wired the Job limits form to report success/error via toast. `jobLimitsAction` now returns a result instead of silently voiding invalid input, and API tests assert both outcomes. Verified Save in the browser on $FOUNDRY_PORT: success toast renders bottom-right.",
    "review: Both acceptance criteria are met: a reusable toast system (`apps/web/src/components/toast.tsx`, mounted once in `(panel)/layout.tsx`) exists, and the Job limits Save path reports success and failure through it. `jobLimitsAction` now returns `JobLimitsResult` instead of silently voiding invalid input, which is a genuine improvement, and the API test asserts both outcomes. I checked code quality, UI design and security. Code quality: the extracted client form keeps `key={limitsKey}` so defaults refresh after save, the async `startTransition` pattern matches `message-composer.tsx`, and no other callers of `jobLimitsAction` exist. UI design: colors, radius, type and tone usage map onto existing tokens (`--bg-raised`, `--radius`, 13px/12px text, `--ok/--warn/--bad/--steel`) and DESIGN.md documents the component; nits below concern padding and live-region announcement. Security: no new input boundary, no secrets, error strings are static and React escapes them; authorization still flows through `teamJob`. I could not execute typecheck or the Vitest suite in this review worktree (no `node_modules` installed) — Biome check on all touched files passes and I verified types by reading. No blocking findings.",
    "reviewing: Reviewer approved. Moving to recipe checks and UI evidence for the toast on the job configuration Save flow.",
    "implementing: Fixed the Auto PR Review non-blocking findings: `.toast` padding now matches DESIGN.md (12px), the live region moved to the persistent `.toasts` container (`aria-live=\"polite\"`, `aria-atomic=\"false\"`, semantic ul/li so the Dismiss button is not inside a `role=\"status\"` region), and the invalid-cost error message is now asserted. The fourth item (component tests for the toast) needs no change: the repo has no DOM/component test project and the reviewer itself noted the UI screenshot is the current proof. Biome, DESIGN.md lint, full recipe checks and the 5-case DB test pass; a fresh screenshot proves the Save toast still renders.",
    "review: Both acceptance criteria are met. The common toast lives in `apps/web/src/components/toast.tsx` (context provider + `useToast()`, tones, 5s auto-dismiss, pause on hover/focus, persistent `aria-live=\"polite\"` viewport, max 3), is documented in DESIGN.md and styled with existing tokens (`--bg-raised`, `--radius`, semantic colors, `--text-dim`), and the provider wraps the panel so any page can use it. The Job limits form now calls `jobLimitsAction` via `useTransition` and shows success/error toasts; the action returns a typed result instead of silently returning, and the DB test asserts both success and both validation errors (including the cost message). The `key={limitsKey}` remount still refreshes defaults after a revalidated save, and the screenshot `evidence/job-config-toast-save.png` shows the toast rendering bottom-right in the saved state.\n\nAreas checked: code quality (correctness, acceptance criteria, tests, scope, maintainability) — applies; UI design — applies and is consistent with DESIGN.md (surface/radius/padding/type, semantic-tone title and border only, reduced-motion fallback, responsive width); security — checked and applies cleanly (no new input surface, `teamJob` team scoping unchanged, static error strings, no secrets). Note that the toast component's render/dismiss behavior has no automated test (the repo has only node-environment unit/api projects, no DOM project), so the screenshot is the proof for that layer; the action-level success and failure paths are covered.\n\nNon-blocking nits only: the client save handler swallows the thrown error without logging, the DESIGN.md \"never take focus\" wording conflicts with the (correctly) focusable Dismiss button, and `JobLimitsResult` duplicates the identical `MessageResult` shape.",
    "reviewing: Reviewer approved the non-blocking fixes. Proceeding to re-run the recipe checks and report confidence.",
    "implementing: The toast implementation is complete on this branch: reusable ToastProvider/useToast mounted in the panel layout, job limits Save reports success and validation errors via toast, and API tests assert both action outcomes. Recipe checks pass and the Save success toast is captured in evidence/job-config-toast-save.png. Requesting the independent review against the current HEAD.",
    "review: Reviewed the full diff against origin/main (toast.tsx, panel layout, job-limits-form.tsx, configuration page, actions.ts, globals.css, DESIGN.md, API tests, evidence).\n\nAcceptance criteria both met: a reusable `ToastProvider`/`useToast` is mounted once in the panel layout (apps/web/src/app/(panel)/layout.tsx), and the Job configuration Save button now reports both outcomes as toasts — success (`tone: \"ok\"`) and validation failure (`tone: \"bad\"` with the action's message). `jobLimitsAction` now returns a `JobLimitsResult`, following the existing `messageAction` pattern; its only caller was updated. Auth scoping is unchanged (`teamJob` still checks job.teamId against the session team), and the client catch path shows a generic message without leaking internals.\n\nCode quality: correct and small. The `key={limitsKey}` remount still refreshes defaults after a save (Next applies `revalidatePath` even when a server action is invoked directly from a transition, as message-composer already relies on), and the pending guard/disabled button prevent double submits. Tests assert `{ok:true}` plus both validation failures, and DB tests run in the recipe because the runner exports FOUNDRY_TEST_DATABASE_URL.\n\nUI design: checked against DESIGN.md — `colors.surface` = --bg-raised, radius 6px = rounded.sm, 12px padding, body-md title at 500, body-sm description, bottom-right stack, 5s auto-dismiss with hover/focus pause, persistent aria-live=\"polite\" region, 200ms/6px enter animation suppressed under prefers-reduced-motion. The attached screenshot shows the success toast rendering correctly above the page grain (z-index 200 > 100) with the green title and dismiss control. The toast component's runtime behavior (auto-dismiss, cap, pause) is not unit-tested, but the repo has no component-test harness and the screenshot is the required UI proof.\n\nSecurity: no security-relevant code changed; no secrets, injection, or new authorization surface. Only minor nits are listed below.",
    "reviewing: Independent review approved the current HEAD. Starting final verification: recipe checks, screenshot evidence, then confidence."
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
  "updatedAt": "2026-11-14T13:42:16.485Z"
}
```
