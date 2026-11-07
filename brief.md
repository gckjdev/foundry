# Handoff brief: Review and improve the testing design and implementation

Stage reached: **investigating** · harness: claude-code · updated 2026-11-07T07:58:20.712Z

## Plan

## Testing architecture (3 layers)

**Layer 1 — unit** (existing, colocated `packages/*/src/*.test.ts`): keep, add coverage instrumentation.

**Layer 2 — component + API** (new, Vitest):
1. Add `@testing-library/react` + `jsdom` to `apps/web`, `@vitest/coverage-v8` at root; wire `vitest.config.ts` (tsx include, `@/` alias, `server-only` stub, jsdom docblocks, v8 coverage).
2. Add reusable web-test seams in `tests/support/`: `server-only.ts`, `web-context.ts` (settable ControlContext), `web-session.ts` (settable user/team), `web-auth.ts`; point `apps/web/src/server/{http,session}.ts` at the `@/server/context` alias so tests can inject them.
3. Component tests: `apps/web/src/components/status.test.tsx`, `live-refresh.test.tsx`; `app/(panel)/jobs/[id]/live-log.test.tsx`; `app/(panel)/runners/join-token.test.tsx`.
4. API tests in `tests/api/`: `http.test.ts` (error mapping + `runnerRoute`), `install-sh.test.ts`, `runner-api.test.ts` (join/heartbeat/claim/jobs actions/readiness/git-token with a real test DB + runner token), `artifacts.test.ts` (upload/read/size limit), `panel-api.test.ts` (events, realtime-token, push subscribe) using the session stub.

**Layer 3 — e2e** (new):
5. Headless job-flow e2e `tests/e2e/job-flow.test.ts` using the existing unused `tests/e2e/harness.ts` (webhook → job → runner daemon → stages → PR) with a FakeHarness.
6. Playwright: `playwright.config.ts` (`testMatch: **/*.spec.ts`), `tests/e2e/browser/` specs for public pages, redirects, install.sh, runner-join validation, and an authenticated board/runners flow with a seeded DB + forged Auth.js session cookie. Add `tests/e2e/browser/server.ts` to migrate/seed a throwaway Postgres and boot `next dev` on `$FOUNDRY_PORT`. E2E stays out of the default recipe (`pnpm test:e2e`), so checks don't need browser downloads.

## Docs + report
7. `docs/testing.md`: layering rules, fixture reuse, commands, and a generated coverage/API/e2e coverage matrix. Add a short "Testing" section to `AGENTS.md` pointing at it.
8. Run `pnpm test:coverage`, record real numbers in the report; run lint/typecheck/tests via `run_checks`.

## Findings

- triage: Ticket is clear: build a 3-layer test architecture (unit, component/API, e2e), reusable fixtures, coverage reporting, and testing docs. Triage found 18 colocated Vitest files (101 passing, 10 DB-gated skips), zero component tests, zero e2e tests despite an unused tests/e2e/harness.ts, no coverage tooling, and no Playwright. Investigating exact seams (route handlers, TestEnv fixtures, Playwright feasibility) next.
- triage: Triage is complete: the ticket asks for a three-layer test architecture (unit, component/API, Playwright e2e), reusable fixtures, coverage reporting, and testing docs. Baseline confirmed 18 colocated Vitest files with no component tests, no e2e runner, and no coverage tooling; Postgres is available for DB-backed tests.
- investigating: Investigated the seams: web route handlers share `@/server/http` (runnerRoute + errorResponse) and `@/server/session`; `@foundry/control/testing` already provides a migrated DB fixture; `tests/e2e/harness.ts` is a complete but unused control-plane+runner e2e harness; Playwright can boot `next dev` and Auth.js session cookies can be forged with `next-auth/jwt`. Plan recorded at the end of investigating.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "4d99db8d-e981-48b2-98d9-a64e744fa571",
  "title": "Review and improve the testing design and implementation",
  "stageReached": "investigating",
  "harness": "claude-code",
  "sessionId": "d281f20e-20aa-448b-80fe-2c88beefc821",
  "plan": "## Testing architecture (3 layers)\n\n**Layer 1 — unit** (existing, colocated `packages/*/src/*.test.ts`): keep, add coverage instrumentation.\n\n**Layer 2 — component + API** (new, Vitest):\n1. Add `@testing-library/react` + `jsdom` to `apps/web`, `@vitest/coverage-v8` at root; wire `vitest.config.ts` (tsx include, `@/` alias, `server-only` stub, jsdom docblocks, v8 coverage).\n2. Add reusable web-test seams in `tests/support/`: `server-only.ts`, `web-context.ts` (settable ControlContext), `web-session.ts` (settable user/team), `web-auth.ts`; point `apps/web/src/server/{http,session}.ts` at the `@/server/context` alias so tests can inject them.\n3. Component tests: `apps/web/src/components/status.test.tsx`, `live-refresh.test.tsx`; `app/(panel)/jobs/[id]/live-log.test.tsx`; `app/(panel)/runners/join-token.test.tsx`.\n4. API tests in `tests/api/`: `http.test.ts` (error mapping + `runnerRoute`), `install-sh.test.ts`, `runner-api.test.ts` (join/heartbeat/claim/jobs actions/readiness/git-token with a real test DB + runner token), `artifacts.test.ts` (upload/read/size limit), `panel-api.test.ts` (events, realtime-token, push subscribe) using the session stub.\n\n**Layer 3 — e2e** (new):\n5. Headless job-flow e2e `tests/e2e/job-flow.test.ts` using the existing unused `tests/e2e/harness.ts` (webhook → job → runner daemon → stages → PR) with a FakeHarness.\n6. Playwright: `playwright.config.ts` (`testMatch: **/*.spec.ts`), `tests/e2e/browser/` specs for public pages, redirects, install.sh, runner-join validation, and an authenticated board/runners flow with a seeded DB + forged Auth.js session cookie. Add `tests/e2e/browser/server.ts` to migrate/seed a throwaway Postgres and boot `next dev` on `$FOUNDRY_PORT`. E2E stays out of the default recipe (`pnpm test:e2e`), so checks don't need browser downloads.\n\n## Docs + report\n7. `docs/testing.md`: layering rules, fixture reuse, commands, and a generated coverage/API/e2e coverage matrix. Add a short \"Testing\" section to `AGENTS.md` pointing at it.\n8. Run `pnpm test:coverage`, record real numbers in the report; run lint/typecheck/tests via `run_checks`.",
  "findings": [
    "triage: Ticket is clear: build a 3-layer test architecture (unit, component/API, e2e), reusable fixtures, coverage reporting, and testing docs. Triage found 18 colocated Vitest files (101 passing, 10 DB-gated skips), zero component tests, zero e2e tests despite an unused tests/e2e/harness.ts, no coverage tooling, and no Playwright. Investigating exact seams (route handlers, TestEnv fixtures, Playwright feasibility) next.",
    "triage: Triage is complete: the ticket asks for a three-layer test architecture (unit, component/API, Playwright e2e), reusable fixtures, coverage reporting, and testing docs. Baseline confirmed 18 colocated Vitest files with no component tests, no e2e runner, and no coverage tooling; Postgres is available for DB-backed tests.",
    "investigating: Investigated the seams: web route handlers share `@/server/http` (runnerRoute + errorResponse) and `@/server/session`; `@foundry/control/testing` already provides a migrated DB fixture; `tests/e2e/harness.ts` is a complete but unused control-plane+runner e2e harness; Playwright can boot `next dev` and Auth.js session cookies can be forged with `next-auth/jwt`. Plan recorded at the end of investigating."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T07:58:20.712Z"
}
```
