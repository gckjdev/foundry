# Handoff brief: Add API document

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-11T08:01:46.501Z

## Plan

1. Add `docs/api.md` — a developer reference for every network surface, organized by owner: conventions (base URL, auth, error mapping), control-plane runner API (`/api/runner/*` incl. per-job actions), panel API, realtime WebSocket protocol, runner-local tool bridge (`POST /tool` over Unix socket/TCP), and the GitHub webhook. Each endpoint gets auth, request/response fields, status codes, and a short example; a source-map table ties each surface to its route/schema files for future refactors.
2. Add `docs/api.zh-CN.md` — full Chinese translation, matching the repo's docs convention.
3. Update `README.md` and `README.zh-CN.md` documentation tables with the new reference.
4. Cross-link from `docs/design/components.md` + `.zh-CN.md` §2.3/§3/§4 (interfaces already summarized there), `AGENTS.md` "Where to look", and the webhook sections of `docs/local-setup.md` + `.zh-CN.md`.
5. Verify markdown/links and run the recipe checks (lint, typecheck, tests) via `run_checks`.

## Findings

- triage: Read every HTTP route under apps/web/src/app, the shared Zod request/response contracts in packages/shared/src/api.ts, the runner's control-plane client (apps/runner/src/api.ts), the local tool bridge (tool-server.ts + packages/mcp-foundry), the realtime WebSocket server, and webhook dispatch in packages/control/src/ingest.ts. Also mapped the docs convention: every human doc has a .zh-CN twin and is indexed in README.
- investigating: The API surfaces and their exact contracts are mapped; writing the reference doc, its Chinese version, and the cross-links now.
- implementing: Added `docs/api.md` and its Chinese twin `docs/api.zh-CN.md` — a developer reference for the control-plane runner API (join/heartbeat/claim/readiness/git-token/artifacts/per-job actions), panel API, realtime WebSocket protocol, runner-local tool bridge, and GitHub webhook, including auth, field tables, examples, error codes, and a source map for future refactors. Cross-linked it from README (both languages), the components design doc (both languages), AGENTS.md "Where to look", and the local-setup webhook sections. `run_checks` passes lint, typecheck and tests.
- review: Docs-only change: adds docs/api.md + docs/api.zh-CN.md and cross-links from README (both), AGENTS.md, docs/design/components.md (both) and docs/local-setup.md (both). No code, UI files or dependencies changed.

Code quality: I verified the reference against the implementation rather than taking it on trust — every route file under apps/web/src/app (runner/*, jobs/:id/events, realtime-token, push/subscribe, artifacts, github/setup, webhooks/github, install.sh), apps/realtime/src/server.ts, apps/runner/src/api.ts, tool-server.ts, job-runner.ts, packages/mcp-foundry/{server,bridge}.ts, packages/shared/{api,events,states,tokens,gate}.ts, packages/control/{runner-api,runners,ingest,artifacts,prs,questions,onboarding}.ts. Auth, request/response field names, status codes, event union, tool schemas, webhook delivery semantics (202/400/401/500, idempotency, 5 attempts), artifact URL TTL, realtime hello/change protocol and 25s ping all match. Heading structure and every relative link/anchor in both languages resolve. Acceptance criteria are met: each surface has auth, fields, codes, examples and a §7 source map; related docs now link to the reference.

UI design: not applicable — no component/page/style/token files changed.

Security: no secrets, tokens or env values in the docs (examples are placeholders); no dependency, migration or CI changes.

Remaining findings are small factual nits about absolute wording; none blocks merge.
- reviewing: The independent reviewer approved the API reference, its Chinese translation, and the cross-links. Running the recipe checks once more on the approved branch before reporting done.

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
  "jobId": "eb755522-d5b1-4fc2-840a-f75d230b6ac1",
  "title": "Add API document",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "d3993d2c-3a25-4835-985d-81e4b85b7fb0",
  "plan": "1. Add `docs/api.md` — a developer reference for every network surface, organized by owner: conventions (base URL, auth, error mapping), control-plane runner API (`/api/runner/*` incl. per-job actions), panel API, realtime WebSocket protocol, runner-local tool bridge (`POST /tool` over Unix socket/TCP), and the GitHub webhook. Each endpoint gets auth, request/response fields, status codes, and a short example; a source-map table ties each surface to its route/schema files for future refactors.\n2. Add `docs/api.zh-CN.md` — full Chinese translation, matching the repo's docs convention.\n3. Update `README.md` and `README.zh-CN.md` documentation tables with the new reference.\n4. Cross-link from `docs/design/components.md` + `.zh-CN.md` §2.3/§3/§4 (interfaces already summarized there), `AGENTS.md` \"Where to look\", and the webhook sections of `docs/local-setup.md` + `.zh-CN.md`.\n5. Verify markdown/links and run the recipe checks (lint, typecheck, tests) via `run_checks`.",
  "findings": [
    "triage: Read every HTTP route under apps/web/src/app, the shared Zod request/response contracts in packages/shared/src/api.ts, the runner's control-plane client (apps/runner/src/api.ts), the local tool bridge (tool-server.ts + packages/mcp-foundry), the realtime WebSocket server, and webhook dispatch in packages/control/src/ingest.ts. Also mapped the docs convention: every human doc has a .zh-CN twin and is indexed in README.",
    "investigating: The API surfaces and their exact contracts are mapped; writing the reference doc, its Chinese version, and the cross-links now.",
    "implementing: Added `docs/api.md` and its Chinese twin `docs/api.zh-CN.md` — a developer reference for the control-plane runner API (join/heartbeat/claim/readiness/git-token/artifacts/per-job actions), panel API, realtime WebSocket protocol, runner-local tool bridge, and GitHub webhook, including auth, field tables, examples, error codes, and a source map for future refactors. Cross-linked it from README (both languages), the components design doc (both languages), AGENTS.md \"Where to look\", and the local-setup webhook sections. `run_checks` passes lint, typecheck and tests.",
    "review: Docs-only change: adds docs/api.md + docs/api.zh-CN.md and cross-links from README (both), AGENTS.md, docs/design/components.md (both) and docs/local-setup.md (both). No code, UI files or dependencies changed.\n\nCode quality: I verified the reference against the implementation rather than taking it on trust — every route file under apps/web/src/app (runner/*, jobs/:id/events, realtime-token, push/subscribe, artifacts, github/setup, webhooks/github, install.sh), apps/realtime/src/server.ts, apps/runner/src/api.ts, tool-server.ts, job-runner.ts, packages/mcp-foundry/{server,bridge}.ts, packages/shared/{api,events,states,tokens,gate}.ts, packages/control/{runner-api,runners,ingest,artifacts,prs,questions,onboarding}.ts. Auth, request/response field names, status codes, event union, tool schemas, webhook delivery semantics (202/400/401/500, idempotency, 5 attempts), artifact URL TTL, realtime hello/change protocol and 25s ping all match. Heading structure and every relative link/anchor in both languages resolve. Acceptance criteria are met: each surface has auth, fields, codes, examples and a §7 source map; related docs now link to the reference.\n\nUI design: not applicable — no component/page/style/token files changed.\n\nSecurity: no secrets, tokens or env values in the docs (examples are placeholders); no dependency, migration or CI changes.\n\nRemaining findings are small factual nits about absolute wording; none blocks merge.",
    "reviewing: The independent reviewer approved the API reference, its Chinese translation, and the cross-links. Running the recipe checks once more on the approved branch before reporting done."
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
  "updatedAt": "2026-11-11T08:01:46.501Z"
}
```
