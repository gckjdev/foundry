# Logging

> 中文版本: [logging.zh-CN.md](logging.zh-CN.md)

Foundry writes **one structured record per line**. The control plane (`apps/web`: panel, webhook
worker), the realtime service and the runner all use the same format and the same logger from
`@foundry/shared`, so one query works across processes.

```json
{
  "ts": "2026-11-10T20:31:05.123Z",
  "level": "info",
  "service": "control",
  "message": "job claimed",
  "correlationId": "3e0f0c4a-5b39-4d1c-9a8e-0f2f1d7c6b51",
  "jobId": "aa9d6b37",
  "runner": "alice-laptop",
  "resumeMode": "sticky",
  "stage": "implementing"
}
```

## Record shape

| Field           | Meaning                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| `ts`            | ISO-8601 UTC timestamp, emitted by the logger                                             |
| `level`         | `debug`, `info`, `warn` or `error`                                                        |
| `service`       | Process that wrote the record: `control`, `webhook`, `web`, `realtime`, `runner`, `proxy` |
| `message`       | Short, stable sentence. **Dynamic values go in fields, never in the message**             |
| `correlationId` | Id shared by every record of one execution (request, delivery, job run)                   |
| _fields_        | Context: `jobId`, `runner`, `repo`, `delivery`, `error`, counts, durations…               |

The logger owns `ts`, `level`, `service` and `message`; a field with one of those names is dropped
instead of overwriting the record.

## Levels

Pick the level by what an operator should do with the line:

- **debug** — high-volume detail used while following one job or delivery: stage changes, webhook
  processed, harness transcript path. Off by default.
- **info** — lifecycle milestones worth alerting or dashboarding on: job created / claimed /
  merged, PR opened, question asked or answered, server listening, webhook accepted.
- **warn** — degraded but recovered, or a best-effort side effect failed: GitHub sync or
  notification failed, readiness failed, invalid `.foundry/recipe.yaml`, rejected webhook,
  checkpoint push failed.
- **error** — the operation failed and needs attention: request returned 500, heartbeat or claim
  failed, worker tick failed, webhook processing failed, job failed.

## Field conventions

| Field                    | Type           | Example                                 |
| ------------------------ | -------------- | --------------------------------------- |
| `jobId`                  | string         | `"aa9d6b37-411c-..."`                   |
| `repo`                   | string         | `"acme/app"`                            |
| `issue`, `pr`            | number         | `42`                                    |
| `runner`                 | string         | `"alice-laptop"`                        |
| `stage`                  | string         | `"verifying"`                           |
| `check`                  | string         | `"lint"`                                |
| `status`                 | string         | `"passed"`, `"failed"`, `"skipped"`     |
| `exitCode`, `durationMs` | number         | `1`, `2431`                             |
| `delivery`, `event`      | string         | GitHub delivery id and event name       |
| `by`, `via`              | string         | `"alice"`, `"panel"` / `"gh_reply"`     |
| `provider`, `operation`  | string         | `"github"`, `"createComment"`           |
| `table`, `rows`          | string, number | `"webhook_inbox"`, `1`                  |
| `correlationId`          | string         | UUID from `newCorrelationId()`          |
| `error`                  | string         | `error.message` from `errorFields(err)` |
| `count`                  | number         | `3`                                     |

Use the `errorFields(err)` helper rather than interpolating an error into the message. It keeps
`error` a plain string and avoids accidentally logging an object that contains tokens.

## Using the logger

```ts
import { createLogger, errorFields } from "@foundry/shared";

const log = createLogger({ service: "control" });
log.info("job claimed", { jobId, runner: runner.name });
log.error("webhook processing failed", { delivery, event, ...errorFields(err) });

// Bind context once; every record from this logger carries it.
const jobLog = log.child({ jobId });
jobLog.warn("check failed", { check: "lint", exitCode: 1 });
```

- `ControlContext.log` is a `Logger`; control-plane code logs through it.
- `JobRunnerDeps.logger` is the daemon logger with `jobId` already bound.
- `DaemonOptions.logger` defaults to `createLogger({ service: "runner" })`.
- Tests use `noopLogger`, or `createLogger({ service: "test", sink: (line) => lines.push(line) })`
  when they assert on output.

`console.log` is for **CLI output** (`foundry status`, `foundry doctor`, scripts), not for
operational logs. Operational code should not use bare `console.*`.

## Correlation

Every execution that spans several records gets one `correlationId`. It is generated at the
boundary (`newCorrelationId()`), bound to a child logger and passed down, so every record of that
execution can be followed with one filter.

```ts
import { newCorrelationId } from "@foundry/shared";
import { withLogFields } from "@foundry/control";

const correlationId = newCorrelationId();
const requestLog = log.child({ correlationId, delivery, event });
// Control code receives a context whose logger already carries the id.
const ctx = withLogFields(await getContext(), { correlationId, delivery, event });
```

- The webhook route generates one id per GitHub delivery and keeps it across `after()` processing.
- The worker generates one id per retried delivery.
- Runner job logs are correlated by `jobId`; add a `correlationId` the same way when a run fans out.

## The `logged` aspect

`logged(log, message, fn, opts)` runs one operation and writes a single record when it finishes:
success at `debug` (or `opts.level`) with `durationMs` and the optional `result` fields, failure at
`error` with `durationMs` and the normalized error. It always rethrows, so callers keep their
existing error handling. Use it for API calls and database reads/writes instead of hand-rolling
start/finish lines.

```ts
import { logged } from "@foundry/shared";

const rows = await logged(ctx.log, "database write", () => ctx.db.insert(webhookInbox).values(row), {
  fields: { table: "webhook_inbox", operation: "insert", deliveryId },
  result: (rows) => ({ inserted: rows.length > 0 }),
});

await logged(ctx.log, "github api call", () => ctx.gh.createComment(ref, issue, body), {
  fields: { provider: "github", operation: "createComment", repo },
});
```

Database and API detail stays at `debug` (off by default) so production stays quiet; decisions and
lifecycle milestones stay at `info`. The **webhook → job-creation** journey is instrumented end to
end as the reference: inbound API request, webhook-inbox writes/reads, the job read/write and every
GitHub call share one `correlationId`.

## Rules

1. Keep `message` stable: it is what you grep, dashboard and alert on. Put ids and values in fields.
2. Log the decision, not every loop iteration. One line per claim, stage, check and gate is
   enough; the harness transcript file holds the verbose detail.
3. Never log secrets, access tokens, proxy userinfo, request bodies or `.env` values. The runner
   scrubs known secrets before writing; the control plane must simply not pass them.
4. Keep messages on one line. The JSON encoder escapes newlines; do not rely on multi-line logs.
5. Do not let logging fail the operation: the logger is synchronous and never throws on a field
   it cannot serialize.

## Configuration

| Variable             | Values           | Default | Applies to                      |
| -------------------- | ---------------- | ------- | ------------------------------- |
| `FOUNDRY_LOG_LEVEL`  | `debug`…`error`  | `info`  | control plane, realtime, runner |
| `FOUNDRY_LOG_FORMAT` | `json`, `pretty` | `json`  | control plane, realtime, runner |

Set them in `.env` for the control plane (`pnpm dev`), and in the shell or the runner's service
environment for the runner. `FOUNDRY_LOG_FORMAT=pretty` renders a single human-readable line:

```text
2026-11-10T20:31:05.123Z INFO  control job claimed jobId=aa9d6b37 runner=alice-laptop
```

## Following one thing

```bash
# Errors while developing
pnpm dev 2>&1 | jq -c 'select(.level == "error")'

# Everything about one job, control plane and runner logs
jq -c 'select(.jobId == "aa9d6b37-411c-49bb-88f9-e4a1d5ffc070")' web.log runner.log

# One execution end to end: API call, database reads/writes and external calls
jq -c 'select(.correlationId == "3e0f0c4a-5b39-4d1c-9a8e-0f2f1d7c6b51")' web.log runner.log

# Webhook deliveries that were rejected
jq -c 'select(.service == "webhook" and .message | startswith("webhook rejected"))' web.log
```

## Where each process writes

- **Control plane** (`pnpm dev`): Next.js stdout. Services `control`, `webhook` and `web`.
- **Realtime** (`apps/realtime`): stdout, service `realtime`.
- **Runner** (`foundry runner start` / `pnpm dev:runner`): stdout. As a launchd/systemd service,
  stdout goes to `$FOUNDRY_HOME/logs` (see `docs/local-setup.md`).
