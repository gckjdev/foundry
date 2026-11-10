# Handoff brief: log improvement

Stage reached: **implementing** · harness: claude-code · updated 2026-11-10T12:45:08.734Z

## Plan

## Goal

One logging standard + one reusable logger, used by the control plane (web/worker/webhook), realtime and runner, with key operational messages at the right level, plus docs.

## 1. Shared logger (`packages/shared/src/log.ts`, new)

- `LogLevel` = debug | info | warn | error, `LogFields`, `Logger` (`debug/info/warn/error/child`), `createLogger(opts)`, `noopLogger`, `errorFields(err)`.
- NDJSON output by default: `{"ts","level","service","message",...fields}`; `FOUNDRY_LOG_FORMAT=pretty` for human lines.
- `FOUNDRY_LOG_LEVEL` filter (default info); injectable `sink`/`now`/`env` for tests; reserved keys cannot be overwritten by fields; `child()` binds fields.
- Export from `packages/shared/src/index.ts`. Unit tests in `log.test.ts`.

## 2. Control plane + webhook

- `ControlContext.log` becomes a `Logger`; `bestEffort` logs `warn`.
- Update all existing `ctx.log(...)` calls to a level (`error` for failures, `warn` for best-effort, `info` for batches).
- Key messages: job created/revived, job claimed (runner, mode, stage), gate evaluated/auto-merged/handed over, job merged/cancelled/retried, webhook accepted/duplicate/processed/failed.
- `apps/web/src/server/context.ts` builds `createLogger({service:"control"})`; `http.ts` logs 500s with an error field; webhook route logs accept/reject/duplicate with delivery+event.
- Tests: `packages/control/testing.ts` uses `noopLogger`; update `surfaces.test.ts` override.

## 3. Runner + realtime + proxy

- `DaemonOptions.log` → `logger?: Logger`; daemon logs structured fields (jobId, counts, error) at proper levels; job logger is a `child({jobId})`.
- `JobRunnerDeps.log` → `logger: Logger`; rename the panel-event helper to `logEvent` and mirror events to the process logger; add key logs for stage changes, checks, PR opened, waiting-for-answer, failures.
- `ReadinessReporter` takes a `Logger`; CLI `runner start` builds a logger with the runner name; realtime and proxy use `createLogger`.
- Update runner unit tests + e2e harness deps to `noopLogger`.

## 4. Docs

- New `docs/logging.md` + `docs/logging.zh-CN.md`: format, levels, field conventions, service names, do/don't (secrets), env vars, examples.
- Link it from `README.md` docs table and add an `AGENTS.md` convention; add a short "Reading logs" note to `docs/local-setup.md`; add commented `FOUNDRY_LOG_LEVEL`/`FOUNDRY_LOG_FORMAT` to `.env.example`.
- Verify: `pnpm exec biome check --write <touched>`, `pnpm typecheck`, `pnpm vitest run` targeted files (shared log tests + control/runner tests).

## Findings

- triage: Ticket is clear: add a shared logging standard/module, wire it through the control plane, webhook ingest and runner, and document it. Current state: control-plane logs only via a JSON one-liner in apps/web/src/server/context.ts, the runner uses ad-hoc `[foundry]` console lines, webhook routes log only failures, there is no reusable logger, and no logging doc exists.
- investigating: Plan recorded: shared structured logger in @foundry/shared, wired into control/webhook/runner/realtime/proxy, docs plus tests.
- implementing: Implemented a shared structured logger (`@foundry/shared/log`) with tests, rewired control-plane/webhook/web/realtime/runner/proxy logging through it with levels and fields, added key lifecycle messages, and documented the standard in docs/logging.md (+ zh-CN) with README/AGENTS/local-setup updates. Targeted typechecks and the full Vitest suite passed locally.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "aa9d6b37-411c-49bb-88f9-e4a1d5ffc070",
  "title": "log improvement",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "e02240f5-a8c1-43a4-914b-43403addca22",
  "plan": "## Goal\n\nOne logging standard + one reusable logger, used by the control plane (web/worker/webhook), realtime and runner, with key operational messages at the right level, plus docs.\n\n## 1. Shared logger (`packages/shared/src/log.ts`, new)\n\n- `LogLevel` = debug | info | warn | error, `LogFields`, `Logger` (`debug/info/warn/error/child`), `createLogger(opts)`, `noopLogger`, `errorFields(err)`.\n- NDJSON output by default: `{\"ts\",\"level\",\"service\",\"message\",...fields}`; `FOUNDRY_LOG_FORMAT=pretty` for human lines.\n- `FOUNDRY_LOG_LEVEL` filter (default info); injectable `sink`/`now`/`env` for tests; reserved keys cannot be overwritten by fields; `child()` binds fields.\n- Export from `packages/shared/src/index.ts`. Unit tests in `log.test.ts`.\n\n## 2. Control plane + webhook\n\n- `ControlContext.log` becomes a `Logger`; `bestEffort` logs `warn`.\n- Update all existing `ctx.log(...)` calls to a level (`error` for failures, `warn` for best-effort, `info` for batches).\n- Key messages: job created/revived, job claimed (runner, mode, stage), gate evaluated/auto-merged/handed over, job merged/cancelled/retried, webhook accepted/duplicate/processed/failed.\n- `apps/web/src/server/context.ts` builds `createLogger({service:\"control\"})`; `http.ts` logs 500s with an error field; webhook route logs accept/reject/duplicate with delivery+event.\n- Tests: `packages/control/testing.ts` uses `noopLogger`; update `surfaces.test.ts` override.\n\n## 3. Runner + realtime + proxy\n\n- `DaemonOptions.log` → `logger?: Logger`; daemon logs structured fields (jobId, counts, error) at proper levels; job logger is a `child({jobId})`.\n- `JobRunnerDeps.log` → `logger: Logger`; rename the panel-event helper to `logEvent` and mirror events to the process logger; add key logs for stage changes, checks, PR opened, waiting-for-answer, failures.\n- `ReadinessReporter` takes a `Logger`; CLI `runner start` builds a logger with the runner name; realtime and proxy use `createLogger`.\n- Update runner unit tests + e2e harness deps to `noopLogger`.\n\n## 4. Docs\n\n- New `docs/logging.md` + `docs/logging.zh-CN.md`: format, levels, field conventions, service names, do/don't (secrets), env vars, examples.\n- Link it from `README.md` docs table and add an `AGENTS.md` convention; add a short \"Reading logs\" note to `docs/local-setup.md`; add commented `FOUNDRY_LOG_LEVEL`/`FOUNDRY_LOG_FORMAT` to `.env.example`.\n- Verify: `pnpm exec biome check --write <touched>`, `pnpm typecheck`, `pnpm vitest run` targeted files (shared log tests + control/runner tests).",
  "findings": [
    "triage: Ticket is clear: add a shared logging standard/module, wire it through the control plane, webhook ingest and runner, and document it. Current state: control-plane logs only via a JSON one-liner in apps/web/src/server/context.ts, the runner uses ad-hoc `[foundry]` console lines, webhook routes log only failures, there is no reusable logger, and no logging doc exists.",
    "investigating: Plan recorded: shared structured logger in @foundry/shared, wired into control/webhook/runner/realtime/proxy, docs plus tests.",
    "implementing: Implemented a shared structured logger (`@foundry/shared/log`) with tests, rewired control-plane/webhook/web/realtime/runner/proxy logging through it with levels and fields, added key lifecycle messages, and documented the standard in docs/logging.md (+ zh-CN) with README/AGENTS/local-setup updates. Targeted typechecks and the full Vitest suite passed locally."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-10T12:45:08.734Z"
}
```
