# Handoff brief: Check error and fix for runner

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-14T14:43:54.095Z

## Plan

The token was genuinely expired; the fix is diagnostics, per the author's choice.

1. `packages/shared/src/tokens.ts` — add `verifyTokenDetailed()` returning `{ ok: true, claims }` or `{ ok: false, reason: "malformed" | "bad-signature" | "expired" }`. Keep `verifyToken()` as a thin wrapper so existing callers are unchanged.
2. `packages/control/src/runners.ts` — `joinRunner()` uses the detailed result: a signature-valid but expired token throws `UnauthorizedError("join token expired")`; anything else throws `UnauthorizedError("join token is invalid")`. Expiry is only revealed after the HMAC verifies, so forged tokens stay generic.
3. `apps/runner/src/api.ts` — `ApiError` keeps the URL-prefixed message but also carries `detail` (the control plane's `error` text) so callers can act on it.
4. `apps/runner/src/cli.ts` — catch a 401 from `joinControlPlane` and rethrow with an actionable line: `<reason>. Create a new join token on the Runners page (<server>/runners) and run this command again.`; the top-level handler prints `ApiError` messages without the stack trace.
5. Tests — `packages/shared/src/shared.test.ts` (expired / bad-signature / malformed reasons), `packages/control/src/control.test.ts` (expired vs invalid join messages via the test clock), `apps/runner/src/api.test.ts` (`ApiError.detail`), new `apps/runner/src/cli.test.ts` (join hint text).
6. Verify — `biome check` on touched files, targeted `vitest run` for shared/control/runner, then `run_checks`.

## Findings

- triage: Confirmed the join token in the ticket expired ~25h before the run (exp 2026-11-13T13:41Z, run 2026-11-14T14:21Z) with the intended 7-day TTL. The rejection is correct but verifyToken collapses expired/invalid into one message and the CLI prints a raw stack. Author chose to improve diagnostics only.
- investigating: Plan recorded: add a detailed token verifier, distinguish expired vs invalid on the join endpoint, surface the server reason on ApiError, and turn a 401 join into one actionable CLI line with no stack trace.
- implementing: Implemented the diagnostics fix: verifyTokenDetailed distinguishes malformed/bad-signature/expired (expiry only after HMAC passes), joinRunner returns "join token expired" vs "join token is invalid", ApiError carries the server's detail text, and the CLI turns a 401 join into one actionable line pointing at the Runners page with no stack trace. Updated EGM contracts and added unit/control/CLI tests; verified 26 unit tests, 36 control tests against a throwaway Postgres, package typechecks, and a real CLI run against a fake 401 endpoint.
- review: Reviewed all three areas. Code quality: the change matches the approved plan exactly — `verifyTokenDetailed` keeps `timingSafeEqual` and only reports `expired` after the HMAC verifies, `joinRunner` maps that to "join token expired" vs "join token is invalid", `ApiError` carries the server's `detail`, and the CLI turns a 401 join into one actionable line pointing at the real `/runners` page (nav label and "Create join token" button both exist). I independently decoded the ticket's token: exp 2026-11-13T13:41Z vs the 2026-11-14T14:21Z log, so expiry is the right diagnosis. The control-plane test is a genuine regression test (old message "invalid or expired join token" would fail both new assertions). No drive-by edits, EGM docs updated consistently. UI design: not applicable — no panel component, style or token changed; the only user-facing text is the new CLI hint, which names the existing page correctly. Security: not applicable as a risk — the expiry distinction is only revealed after the signature verifies, the join token never appears in the new messages, `verifyToken`'s callers keep the same behaviour, and no auth/permission logic changed. Only non-blocking nits remain (CLI glue untested, api.md wording, punctuation handling).
- reviewing: Reviewer approved the diagnostics change. Running the repo's recipe checks now.

## Checks

_not run_

## Questions and answers

- Q: Your join token expired on 2026-11-13T13:41Z (issued 2026-11-06 with the 7-day TTL); the command ran 2026-11-14T14:21Z, so the rejection is correct but the error is unhelpful. What should I change? (1) Make the failure self-explanatory: server distinguishes "expired" from "invalid", CLI prints a concise message telling you to create a new token on the Runners page, no stack trace. (2) That plus extend the join-token lifetime from 7 to 30 days and show the expiry in the panel. (3) Only extend the lifetime, leave the error as is.
  A: Clearer expired-vs-invalid error + actionable CLI hint (recommended)

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "b2ab3c97-54c3-454f-a4de-ed3c154f4379",
  "title": "Check error and fix for runner",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "6ee7cf50-7892-476a-b164-b2d56e873f8b",
  "plan": "The token was genuinely expired; the fix is diagnostics, per the author's choice.\n\n1. `packages/shared/src/tokens.ts` — add `verifyTokenDetailed()` returning `{ ok: true, claims }` or `{ ok: false, reason: \"malformed\" | \"bad-signature\" | \"expired\" }`. Keep `verifyToken()` as a thin wrapper so existing callers are unchanged.\n2. `packages/control/src/runners.ts` — `joinRunner()` uses the detailed result: a signature-valid but expired token throws `UnauthorizedError(\"join token expired\")`; anything else throws `UnauthorizedError(\"join token is invalid\")`. Expiry is only revealed after the HMAC verifies, so forged tokens stay generic.\n3. `apps/runner/src/api.ts` — `ApiError` keeps the URL-prefixed message but also carries `detail` (the control plane's `error` text) so callers can act on it.\n4. `apps/runner/src/cli.ts` — catch a 401 from `joinControlPlane` and rethrow with an actionable line: `<reason>. Create a new join token on the Runners page (<server>/runners) and run this command again.`; the top-level handler prints `ApiError` messages without the stack trace.\n5. Tests — `packages/shared/src/shared.test.ts` (expired / bad-signature / malformed reasons), `packages/control/src/control.test.ts` (expired vs invalid join messages via the test clock), `apps/runner/src/api.test.ts` (`ApiError.detail`), new `apps/runner/src/cli.test.ts` (join hint text).\n6. Verify — `biome check` on touched files, targeted `vitest run` for shared/control/runner, then `run_checks`.",
  "findings": [
    "triage: Confirmed the join token in the ticket expired ~25h before the run (exp 2026-11-13T13:41Z, run 2026-11-14T14:21Z) with the intended 7-day TTL. The rejection is correct but verifyToken collapses expired/invalid into one message and the CLI prints a raw stack. Author chose to improve diagnostics only.",
    "investigating: Plan recorded: add a detailed token verifier, distinguish expired vs invalid on the join endpoint, surface the server reason on ApiError, and turn a 401 join into one actionable CLI line with no stack trace.",
    "implementing: Implemented the diagnostics fix: verifyTokenDetailed distinguishes malformed/bad-signature/expired (expiry only after HMAC passes), joinRunner returns \"join token expired\" vs \"join token is invalid\", ApiError carries the server's detail text, and the CLI turns a 401 join into one actionable line pointing at the Runners page with no stack trace. Updated EGM contracts and added unit/control/CLI tests; verified 26 unit tests, 36 control tests against a throwaway Postgres, package typechecks, and a real CLI run against a fake 401 endpoint.",
    "review: Reviewed all three areas. Code quality: the change matches the approved plan exactly — `verifyTokenDetailed` keeps `timingSafeEqual` and only reports `expired` after the HMAC verifies, `joinRunner` maps that to \"join token expired\" vs \"join token is invalid\", `ApiError` carries the server's `detail`, and the CLI turns a 401 join into one actionable line pointing at the real `/runners` page (nav label and \"Create join token\" button both exist). I independently decoded the ticket's token: exp 2026-11-13T13:41Z vs the 2026-11-14T14:21Z log, so expiry is the right diagnosis. The control-plane test is a genuine regression test (old message \"invalid or expired join token\" would fail both new assertions). No drive-by edits, EGM docs updated consistently. UI design: not applicable — no panel component, style or token changed; the only user-facing text is the new CLI hint, which names the existing page correctly. Security: not applicable as a risk — the expiry distinction is only revealed after the signature verifies, the join token never appears in the new messages, `verifyToken`'s callers keep the same behaviour, and no auth/permission logic changed. Only non-blocking nits remain (CLI glue untested, api.md wording, punctuation handling).",
    "reviewing: Reviewer approved the diagnostics change. Running the repo's recipe checks now."
  ],
  "checks": [],
  "qa": [
    {
      "question": "Your join token expired on 2026-11-13T13:41Z (issued 2026-11-06 with the 7-day TTL); the command ran 2026-11-14T14:21Z, so the rejection is correct but the error is unhelpful. What should I change? (1) Make the failure self-explanatory: server distinguishes \"expired\" from \"invalid\", CLI prints a concise message telling you to create a new token on the Runners page, no stack trace. (2) That plus extend the join-token lifetime from 7 to 30 days and show the expiry in the panel. (3) Only extend the lifetime, leave the error as is.",
      "answer": "Clearer expired-vs-invalid error + actionable CLI hint (recommended)"
    }
  ],
  "uncertainties": [],
  "updatedAt": "2026-11-14T14:43:54.095Z"
}
```
