# Foundry API reference

> 中文版本: [api.zh-CN.md](api.zh-CN.md)

Foundry has five network surfaces. The control plane owns four of them (`apps/web` serves the
runner API, the panel API and the webhook; `apps/realtime` serves the WebSocket). The runner owns
the fifth: a local tool bridge that the per-job `foundry` MCP server calls.

| Surface            | Transport                                  | Caller                        | Authentication                                  |
| ------------------ | ------------------------------------------ | ----------------------------- | ----------------------------------------------- |
| Runner API         | HTTPS `/api/runner/*` on the control plane | Runner daemon                 | Join token, then `Authorization: Bearer fdr_…`  |
| Panel API          | HTTPS `/api/*` on the control plane        | Panel browser                 | Auth.js session cookie + selected-team cookie   |
| Realtime           | WebSocket                                  | Panel and runner              | Signed realtime token                           |
| Runner tool bridge | `POST /tool` on a Unix socket or TCP       | The job's `foundry mcp` child | Per-job tool token                              |
| GitHub webhook     | HTTPS `POST /api/webhooks/github`          | GitHub                        | HMAC-SHA256 signature (`GITHUB_WEBHOOK_SECRET`) |

`GET /install.sh` is public and serves the runner installer.

The JSON contracts in this document are defined once, as zod schemas, in
[`packages/shared/src/api.ts`](../packages/shared/src/api.ts) (job events are in
[`events.ts`](../packages/shared/src/events.ts)). Both sides validate with those schemas. The
document is a reference to the current implementation, not a versioned public API: the runner and
control plane are released together. When you change a contract, change the zod schema, the
caller, the tests and this document in the same pull request (see
[§7](#7-changing-a-contract)).

## Contents

1. [Conventions](#1-conventions)
2. [Control plane — runner API](#2-control-plane--runner-api)
3. [Control plane — panel API](#3-control-plane--panel-api)
4. [Control plane — realtime WebSocket](#4-control-plane--realtime-websocket)
5. [Runner — local tool bridge](#5-runner--local-tool-bridge)
6. [GitHub webhook](#6-github-webhook)
7. [Changing a contract](#7-changing-a-contract)

---

## 1. Conventions

**Base URL.** The control plane listens on `FOUNDRY_PUBLIC_URL` (default
`http://localhost:3000`). The runner stores the server URL given to `foundry runner join --server`
and appends `/api/runner`. The panel calls the same origin it is served from.

**Encoding.** Requests and responses are UTF-8 JSON with `content-type: application/json`, except:

- `POST /api/runner/artifacts` — the body is the raw file.
- `GET /api/artifacts/:id` — the response is the raw file.
- `GET /install.sh` — `text/x-shellscript`.

**Validation.** Every JSON body, path parameter and query value is parsed with zod at the
boundary. A parse failure returns `400`:

```json
{
  "error": "invalid request",
  "issues": [
    { "code": "too_small", "path": ["name"], "message": "String must contain at least 1 character(s)" }
  ]
}
```

**Errors.** Every error response is `{ "error": "<message>" }`; validation failures also include
`issues`. Status codes are consistent across surfaces:

| Status | Meaning                                                                    |
| ------ | -------------------------------------------------------------------------- |
| `400`  | Body or parameters failed validation (also malformed JSON on webhooks)     |
| `401`  | Missing, unknown, expired or removed credential (join token, runner, …)    |
| `403`  | Authenticated but not allowed                                              |
| `404`  | Unknown resource, unknown runner action, or expired artifact token         |
| `409`  | Conflict: job not held by this runner, illegal job transition, wrong repo  |
| `413`  | Artifact larger than 10 MiB                                                |
| `500`  | Unexpected failure. In production the detail is hidden as `internal error` |

**Identifiers and time.** IDs are opaque strings (UUIDs) — never parse them. Timestamps are
ISO-8601 UTC strings (`2026-11-11T09:30:00.000Z`). Durations are integer milliseconds. Costs are
USD as JSON numbers.

**Tenancy.** Every runner token belongs to one team, and every panel request is scoped to the
selected team (`foundry_team` cookie, else the user's first team). Cross-team reads and writes
are rejected as not found, conflicted or redirected.

---

## 2. Control plane — runner API

Everything under `/api/runner` is called by a joined runner. The exception is `join`, which
exchanges a signed join token for a runner token. All other endpoints require:

```http
Authorization: Bearer fdr_<random>
```

The token is returned once by `join` and stored as a SHA-256 hash. A runner that the panel removed
gets `401` on every call. Field names below match the runner's own client
([`apps/runner/src/api.ts`](../apps/runner/src/api.ts)).

| Method | Path                           | Purpose                                                       |
| ------ | ------------------------------ | ------------------------------------------------------------- |
| `POST` | `/api/runner/join`             | Register a machine; exchange a join token for a runner token  |
| `POST` | `/api/runner/heartbeat`        | Report resources and running jobs; receive assignments/config |
| `POST` | `/api/runner/claim`            | Atomically claim the next eligible queued job                 |
| `POST` | `/api/runner/readiness`        | Report per-repo recipe readiness                              |
| `POST` | `/api/runner/git-token`        | Mint a short-lived installation token for git                 |
| `POST` | `/api/runner/artifacts`        | Upload a screenshot or other artifact                         |
| `POST` | `/api/runner/jobs/:id/:action` | Report anything about a job the runner holds                  |

### 2.1 `POST /api/runner/join`

Registers a runner with a join token created in the panel (**Runners → Create join token**).
No bearer token is required. Join tokens look like `fdj_…` and expire after **7 days**.

| Field            | Type                            | Notes                                                                    |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `joinToken`      | string                          | Signed, team-scoped `fdj_…` token                                        |
| `name`           | string (min 1)                  | Display name; unique per team. Re-joining with the same name replaces it |
| `kind`           | `shared` \| `personal`          | `personal` is owned by the member who created the join token             |
| `os`             | `macos` \| `linux` \| `windows` |                                                                          |
| `arch`           | string                          | For example `arm64`, `x64`                                               |
| `osVersion`      | string                          | For example `15.1`, `24.04`                                              |
| `cpu`            | integer > 0                     | Core count                                                               |
| `memMb`          | integer > 0                     | Total memory in MiB                                                      |
| `maxConcurrency` | integer > 0                     | Jobs this daemon may run at once                                         |

```json
// request
{
  "joinToken": "fdj_eyJraW5kIjoiam9pbiIs...",
  "name": "alice-mbp",
  "kind": "personal",
  "os": "macos",
  "arch": "arm64",
  "osVersion": "15.1",
  "cpu": 10,
  "memMb": 32000,
  "maxConcurrency": 1
}
```

```json
// 200
{
  "runnerId": "4b0f4f0e-9a56-4a5f-8d9f-2e0f6b7c8d90",
  "runnerToken": "fdr_<secret>",
  "teamId": "0e9c2a6c-1f3e-4c5d-9b7a-8f1e2d3c4b5a"
}
```

`401` means the join token is invalid, expired, or not a join token.

### 2.2 `POST /api/runner/heartbeat`

Sent every heartbeat interval while the daemon runs. It updates the runner row, returns the
current team configuration, and tells the daemon what to stop, keep and report against.

Request body:

| Field                | Type                                  | Notes                                                  |
| -------------------- | ------------------------------------- | ------------------------------------------------------ |
| `cpu`                | integer > 0                           |                                                        |
| `memMb`              | integer > 0                           |                                                        |
| `diskFreeMb`         | integer ≥ 0                           | Free disk where runner data lives                      |
| `onAcPower`          | boolean \| null                       | `null` when the OS cannot tell                         |
| `accepting`          | boolean                               | Whether the daemon is currently taking claims          |
| `notAcceptingReason` | string \| null (optional)             | For example `draining`, `low disk`, `outside schedule` |
| `runningJobIds`      | string[]                              | Jobs this daemon is executing right now                |
| `harnesses`          | `{id, installed, version?, authOk}[]` | Detected harnesses and whether they are signed in      |
| `maxConcurrency`     | integer > 0                           |                                                        |
| `version`            | string                                | Runner version                                         |

Response body:

| Field           | Type     | Notes                                                                                          |
| --------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `realtimeUrl`   | string   | WebSocket URL to open                                                                          |
| `realtimeToken` | string   | Signed token, valid for **1 hour**; claims are `{teamId, sub: runnerId, kind: "runner"}`       |
| `draining`      | boolean  | The panel asked this runner to drain; stop claiming                                            |
| `revokedJobIds` | string[] | Jobs the daemon reported but the control plane no longer assigns to it — stop and release them |
| `keepJobIds`    | string[] | Jobs that are still this runner's (`needs_input` or a running stage); keep them parked         |
| `jobLimits`     | object[] | `{jobId, maxJobMinutes, maxCostUsd}` — live limit overrides for already-running jobs           |
| `repos`         | object[] | `{id, fullName, defaultBranch, recipeSha, acceptsJobs}` for the team's repos                   |

```json
// 200
{
  "realtimeUrl": "ws://localhost:3001",
  "realtimeToken": "<signed token>",
  "draining": false,
  "revokedJobIds": [],
  "keepJobIds": ["9d1c…"],
  "jobLimits": [{ "jobId": "9d1c…", "maxJobMinutes": 90, "maxCostUsd": 12.5 }],
  "repos": [
    {
      "id": "c1a2…",
      "fullName": "acme/app",
      "defaultBranch": "main",
      "recipeSha": "a1b2c3…",
      "acceptsJobs": true
    }
  ]
}
```

A heartbeat also re-queues jobs the runner stopped reporting, and applies panel changes (drain,
limits, repo readiness) without a restart.

### 2.3 `POST /api/runner/claim`

Atomically claims the best eligible queued job for this runner. The request body is ignored; an
empty object is fine. The response is `{ "job": ClaimedJob | null }`.

`null` is normal: the runner is draining or removed, the team reached its daily spend cap, the
repo is not onboarded, no repo is ready on this runner, or another runner outranks it in the
scheduler. The daemon simply tries again on the next heartbeat.

```json
// 200 — nothing to do
{ "job": null }
```

```json
// 200 — claimed
{
  "job": {
    "id": "9d1c…",
    "kind": "ticket",
    "repo": { "id": "c1a2…", "fullName": "acme/app", "defaultBranch": "main" },
    "issueNumber": 84,
    "title": "Add API document",
    "body": "### Goal\n…",
    "author": "gckjdev",
    "harness": "claude-code",
    "model": null,
    "playbook": "default",
    "branch": "foundry/…",
    "resumeStage": "triage",
    "sessionId": null,
    "resumeMode": "fresh",
    "loopCount": 0,
    "costUsd": 0,
    "maxJobMinutes": null,
    "maxCostUsd": null,
    "pendingInputs": [],
    "mergeMode": "off",
    "prReview": null
  }
}
```

| Claimed job field | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `kind`            | `ticket` or `onboarding`                                                               |
| `resumeStage`     | Stage to start (or restart) at: `triage`, `investigating`, … or `pr_review`            |
| `resumeMode`      | `fresh` (new worktree/session), `sticky` (this runner's native session), or `portable` |
| `sessionId`       | Native harness session to resume, when this runner can                                 |
| `loopCount`       | Verify/fix loops already used                                                          |
| `pendingInputs`   | Answers and messages queued while the job was parked; claim consumes them              |
| `mergeMode`       | `off` or `merge_when_confident` — the effective policy for this repo                   |
| `prReview`        | Only on a `pr_review` claim: the PR head and failed CI checks to investigate            |

### 2.4 `POST /api/runner/readiness`

Reports whether this machine can run jobs for a repo at a recipe revision. Before reporting, the
daemon clones the default branch into a detached worktree, checks the recipe's OS constraint and
`system_deps`, then runs its warm/install/check steps (with a 20-minute budget). The control plane
only stores the latest result per `(runner, repo)`.

| Field       | Type           | Notes                                                          |
| ----------- | -------------- | -------------------------------------------------------------- |
| `repoId`    | string         | Must belong to the runner's team                               |
| `recipeSha` | string \| null | Recipe revision the result applies to                          |
| `ready`     | boolean        |                                                                |
| `reason`    | string \| null | Why not ready, for the panel (for example `missing: node>=22`) |

Response: `200 { "ok": true }`. An unknown or foreign repo returns `401`.

### 2.5 `POST /api/runner/git-token`

Mints a short-lived GitHub App installation token for fetch/push. The runner passes it to git
through `http.extraheader`, never through the remote URL or argv.

| Field    | Type   | Notes                                 |
| -------- | ------ | ------------------------------------- |
| `repoId` | string | Repo must belong to the runner's team |

```json
// 200
{ "token": "ghs_…", "expiresAt": "2026-11-11T10:30:00.000Z" }
```

A repo outside the runner's team returns `409`.

### 2.6 `POST /api/runner/artifacts`

Raw artifact upload. The body is the file itself; metadata travels in headers. Maximum size is
**10 MiB** (`413` above that).

| Header           | Required | Notes                                                       |
| ---------------- | -------- | ----------------------------------------------------------- |
| `authorization`  | yes      | `Bearer <runnerToken>`                                      |
| `x-foundry-job`  | yes      | Job ID; it must be held by this runner                      |
| `x-foundry-name` | no       | Display/file name; defaults to `artifact`                   |
| `content-type`   | no       | Stored content type; defaults to `application/octet-stream` |

```json
// 200
{
  "artifactId": "77e1…",
  "url": "https://foundry.example.com/api/artifacts/77e1…?t=<signed token>"
}
```

The returned URL is signed, valid for **30 days**, and readable without a panel session so that
screenshots embedded in a PR body render for reviewers. A job the runner no longer holds returns
`409`.

### 2.7 `POST /api/runner/jobs/:id/:action`

One endpoint for everything a runner reports about a job it holds. `id` is the job UUID; `action`
is one of the names below. The runner must still own the job and the job must be in a running
status (`triage`, `investigating`, `implementing`, `reviewing`, `verifying`, `pr_review`); otherwise
the call returns `409 { "error": "job is not held by this runner" }` (an unknown job id returns
`404`). An unknown action returns `404 { "error": "unknown action <name>" }`.

| Action       | Request body                                                       | Success response                    | Effect                                                        |
| ------------ | ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------- |
| `events`     | `{ events: FoundryEvent[] }` (1–200)                               | `{ ok: true }`                      | Appends job-log events                                        |
| `stage`      | `StageRequest`                                                     | `{ status }`                        | Transitions the job; `409` if the edge is illegal             |
| `ask`        | `{ prompt: string, options?: string[] }` (≤ 6 options)             | `{ questionId }`                    | Parks the job and posts a question to the issue               |
| `evidence`   | `EvidenceRequest`                                                  | `{ id }`                            | Records gate evidence                                         |
| `confidence` | `{ level: "high" \| "medium" \| "low", reasons?, uncertainties? }` | `{ ok: true }`                      | Stores the agent's self-assessment                            |
| `plan`       | `{ plan: string }`                                                 | `{ ok: true }`                      | Stores the implementation plan                                |
| `checkpoint` | `{ stage, sessionId, briefRef, headSha }`                          | `{ ok: true }`                      | Saves resume state for a hand-back or machine move            |
| `pr`         | `{ title, summary, headSha, uiChanged, changedLines }`             | `{ prNumber, url }`                 | Opens/updates the PR, then transitions to `pr_ci` and gates   |
| `pr-review`  | `PrReviewRequest`                                                  | `{ status }`                        | Publishes the automatic PR review and moves the job on        |
| `onboarding` | `{ ok, reason, headSha, summary }`                                 | `{ pr: { prNumber, url } \| null }` | Completes onboarding; `ok: false` fails the job               |
| `inputs`     | `{ take?: boolean }` (default `true`)                              | `{ inputs: PendingInput[] }`        | Returns queued human answers/messages; `take` marks delivered |

#### `stage` request

| Field                | Type                           | Notes                                                                  |
| -------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `to`                 | JobStatus                      | Target status; must be a legal edge in `packages/shared/src/states.ts` |
| `reason`             | string (optional)              | Shown in the timeline and on failure                                   |
| `lastCompletedStage` | RunnerStage \| null (optional) | Used to compute `resumeStage` when handing the job back                |
| `loopCount`          | integer (optional)             |                                                                        |
| `sessionId`          | string \| null (optional)      | Native harness session for resume                                      |
| `worktreePath`       | string \| null (optional)      | Local worktree to reuse on a sticky resume                             |
| `portBase`           | integer \| null (optional)     | First port of the job's leased block                                   |

The runner normally advances one stage at a time. It also sends `queued` to hand the job back
(schedule pause or shutdown — the control plane stamps the sticky window and resume stage) and
`failed` with a scrubbed reason. `needs_input` is set by `ask` or the panel, not by the runner.
`done` is an MCP-only concept: the runner verifies, opens the PR, and reports through `pr`.

#### Automatic PR review

When `.foundry/policy.yaml` sets `auto_pr_review: true`, a job in `pr_ci` is re-queued with
`resumeStage: "pr_review"` once the PR head's CI checks finish (once per head SHA). If a repo
registers no checks at all, the worker starts the review on its next pass (it calls the gate with
`allowNoCi`). The claim's
`prReview` field carries the PR and the failed checks: `{ prNumber, url, headSha, ciFailures }`,
where each failure has `name`, `conclusion`, `summary`, `detailsUrl` and `annotations`
(`path`, optional `line`, `message`).

The runner reviews the pushed head in a detached read-only worktree and reports through
`pr-review`:

| Field      | Type                                              | Notes                                                      |
| ---------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `verdict`  | `approve` \| `request_changes`                    |                                                            |
| `summary`  | string                                            |                                                            |
| `findings` | `{ severity, category, file?, line?, message }[]` | `file` + `line` become inline review comments when valid.  |

The control plane posts the result as a `COMMENT` review on the PR — the Foundry App authors the
PR, so GitHub will not accept an `APPROVE` or `REQUEST_CHANGES` event from it — and records
`code review` evidence. Approval returns the job to `pr_ci`, but **the gate never auto-merges a job
with `auto_pr_review` on**: the review is advisory, and the PR waits for a human to merge
(`human_review` rule). Blocking findings become a message and re-queue the job at `implementing`
for up to `max_review_loops` rounds; after that the job is handed to the ticket author.

#### `evidence` request

| Field        | Type                                          | Notes                                                                                             |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `kind`       | `check` \| `screenshot` \| `note` \| `review` | `check` and `review` are recorded by the runner; the agent's tool records `screenshot` and `note` |
| `name`       | string                                        | Stable evidence name; the gate reads `code review`                                                |
| `status`     | `passed` \| `failed` \| `skipped`             |                                                                                                   |
| `command`    | string \| null                                | For checks                                                                                        |
| `exitCode`   | integer \| null                               | For checks                                                                                        |
| `outputTail` | string \| null (≤ 20,000 chars)               | Scrubbed output                                                                                   |
| `durationMs` | integer \| null                               |                                                                                                   |
| `artifactId` | string \| null                                | Required for a screenshot                                                                         |

#### `inputs` response

`PendingInput` is either an answer to a question or a free-form message:

```json
{
  "inputs": [
    { "kind": "answer", "text": "Use CSV", "by": "alice", "questionPrompt": "CSV or XLSX?" },
    {
      "kind": "message",
      "text": "Please also update the README",
      "by": "bob",
      "attachments": [
        {
          "artifactId": "77e1…",
          "name": "mock.png",
          "contentType": "image/png",
          "url": "https://foundry.example.com/api/artifacts/77e1…?t=…"
        }
      ]
    }
  ]
}
```

`attachments[].url` is a signed artifact URL so a runner on another machine can download an image
a human attached in the panel.

#### `events` bodies

A job event is one of the discriminated-union members in
[`packages/shared/src/events.ts`](../packages/shared/src/events.ts):

| `kind`             | Payload                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `stage_changed`    | `{from, to, reason?}`                                                  |
| `subagent_started` | `{name}`                                                               |
| `tool_call`        | `{tool, summary?}`                                                     |
| `usage`            | `{model?, tokensIn, tokensOut, costUsd}`                               |
| `message`          | `{role: "agent" \| "human" \| "system", text}`                         |
| `question`         | `{questionId, prompt}`                                                 |
| `answer`           | `{questionId, text, by}`                                               |
| `evidence`         | `{name, status}`                                                       |
| `log`              | `{level, message}`                                                     |
| `resumed`          | `{runnerId, runnerName, mode: "sticky" \| "portable", harnessChanged}` |
| `gate`             | `{pass, failed: [{rule, detail}]}`                                     |
| `checkpoint`       | `{stage, briefRef}`                                                    |
| `error`            | `{message}`                                                            |

The runner batches up to 200 events per call. Events are append-only and drive the job timeline,
usage accounting and cost caps.

---

## 3. Control plane — panel API

Panel endpoints are authenticated by the Auth.js session cookie. They resolve the current team
from the `foundry_team` cookie (falling back to the user's first team) and scope every read to
that team. Unauthenticated calls redirect to `/signin`; users without a team redirect to `/setup`.
These are browser APIs for the panel — they are not part of the runner contract.

| Method       | Path                              | Auth            | Purpose                                             |
| ------------ | --------------------------------- | --------------- | --------------------------------------------------- |
| `GET`        | `/api/jobs/:id/events?after=<id>` | session         | Incremental job timeline for the live log           |
| `GET`        | `/api/realtime-token`             | session         | WebSocket URL and a fresh realtime token            |
| `POST`       | `/api/push/subscribe`             | session         | Store the browser push subscription                 |
| `GET`        | `/api/push/subscribe`             | public          | VAPID public key for `PushManager.subscribe`        |
| `GET`        | `/api/artifacts/:id?t=<token>`    | signed URL      | Download an artifact (screenshots, notes)           |
| `GET`        | `/api/github/setup`               | session (admin) | GitHub App Setup URL / post-login installation link |
| `GET`/`POST` | `/api/auth/[...nextauth]`         | —               | Auth.js sign-in, callback and session handlers      |
| `GET`        | `/install.sh`                     | public          | Runner installer script                             |

### 3.1 `GET /api/jobs/:id/events`

Returns stored event rows for one job in the caller's team with `id > after` (default `0`), at most
500. The job page polls this after a realtime poke; the realtime message never carries event
bodies. `payload` is the `FoundryEvent` union from §2.7.

```json
{
  "events": [
    {
      "id": 412,
      "jobId": "9d1c…",
      "teamId": "0e9c…",
      "ts": "2026-11-11T09:30:00.000Z",
      "kind": "log",
      "stage": "implementing",
      "payload": { "kind": "log", "level": "info", "message": "job claimed" }
    }
  ]
}
```

An unknown job in another team yields an empty list rather than a cross-team read.

### 3.2 `GET /api/realtime-token`

```json
{ "url": "ws://localhost:3001", "token": "<signed token>" }
```

The token claims `{teamId, sub: userId, kind: "user"}` and is valid for **1 hour**. Reconnect with
a fresh token when the socket closes or the token expires.

### 3.3 Push subscription

`POST /api/push/subscribe` takes the browser's `PushSubscription` JSON, stores it on the user and
sets the notification preference to push: `200 { "ok": true }`. `GET` returns
`{ "publicKey": "<VAPID public key>" }` (or `null` when push is not configured).

### 3.4 `GET /api/artifacts/:id`

Serves the stored bytes when `t` is a valid signed token for that artifact (`404` otherwise). The
response uses the stored content type, `content-disposition: inline` and
`cache-control: private, max-age=86400`.

### 3.5 `GET /api/github/setup`

GitHub redirects here after an App installation (`?installation_id=<id>`), and it doubles as the
post-login landing. With no session it stores the installation in a short-lived `foundry_install`
cookie and redirects to `/signin`; after sign-in, a team admin links the installation to the
selected team and is redirected to `/repos?installed=1`. A signed-in admin with no installation
id instead syncs unlinked installations and is redirected to `/repos?installed=1`.

### 3.6 `GET /install.sh`

Public installer used by `curl -fsSL <server>/install.sh | sh -s -- <fdj_token>`. The script joins
the runner to the server in `FOUNDRY_PUBLIC_URL`.

---

## 4. Control plane — realtime WebSocket

`apps/realtime` turns one Postgres `LISTEN foundry_changes` connection into per-team WebSocket
messages. It is a wake-up channel only: messages carry identifiers, and clients refetch rows
through the panel API or act on a heartbeat's response.

**URL.** The control plane advertises `FOUNDRY_REALTIME_URL`. `.env.example` points at
`ws://localhost:3001`; when it is unset the web app derives `ws://<public host>/realtime`, and the
compose stack proxies `/realtime` through Caddy. Clients use the value returned by
`/api/realtime-token` or heartbeat.

**Authentication.** Supply the token in the query string or as the second WebSocket subprotocol
(browsers cannot set request headers on a WebSocket):

```js
new WebSocket(`${url}?token=${token}`);
// or
new WebSocket(url, ["foundry", token]);
```

Missing, invalid or expired tokens are rejected during the HTTP upgrade with `401 Unauthorized`.

**Messages.** On connect the server sends:

```json
{ "type": "hello", "teamId": "0e9c…" }
```

Then, for every change in that team:

```json
{ "type": "change", "table": "jobs", "id": "9d1c…", "op": "UPDATE", "columns": ["status"] }
```

`columns` may be omitted or empty. Only changes whose `team_id` matches the token's team are
delivered. The server pings every 25 seconds; a client that misses a pong, or whose token expired,
is terminated and must reconnect with a fresh token.

**Health.** `GET /healthz` returns `200 ok`. Any other non-WebSocket request returns
`426 WebSocket only`.

**Without Postgres.** The service still accepts connections and sends `hello`, but broadcasts
nothing (used by health checks and tests).

---

## 5. Runner — local tool bridge

Every job gets a dedicated `foundry` MCP server process (started by the harness). That process
speaks MCP over stdio to the agent and forwards each tool call to the runner through a local HTTP
server. Nothing here is exposed off the machine.

**Transport.**

| Environment variable | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `FOUNDRY_MCP_SOCKET` | Unix socket path (macOS/Linux)                                  |
| `FOUNDRY_MCP_URL`    | Loopback base URL such as `http://127.0.0.1:53211` (Windows)    |
| `FOUNDRY_JOB_ID`     | Job the tools report on                                         |
| `FOUNDRY_MCP_TOKEN`  | Per-job token issued when the job's tool handler was registered |

**Request.** `POST /tool` with JSON:

```json
{
  "jobId": "9d1c…",
  "token": "<FOUNDRY_MCP_TOKEN>",
  "tool": "stage",
  "args": { "name": "investigating", "summary": "Found the route and its tests." }
}
```

A call whose `jobId`/`token` pair is not registered — including a job trying to report on another
job — returns `403`:

```json
{ "text": "This job is not running on this runner.", "isError": true }
```

A handler crash or malformed request returns `500` with `{ "text": "Runner error: …", "isError": true }`.
Normal tool-level failures are returned as `200` with `isError: true` so the agent can read and
react to the message. The client allows up to 30 minutes per call because `run_checks` can be slow.

**Response.** `{ "text": "<message for the agent>", "isError"?: true }`. The MCP server turns
`text` into a single text content block.

### 5.1 Tools

| Tool         | Arguments                                                                                                        | What the runner does                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `stage`      | `{ name: "investigating" \| "implementing" \| "reviewing" \| "verifying" \| "done", summary }`                   | Enforces stage order; reports `stage` upstream and checkpoints. `done` runs the verify/PR path |
| `plan`       | `{ plan: string }`                                                                                               | Stores the plan and emits a message event                                                      |
| `ask`        | `{ question: string, options?: string[] }`                                                                       | Parks the job after a grace period and posts the question                                      |
| `evidence`   | `{ kind: "screenshot" \| "note", name, status?, path?, detail? }`                                                | Notes are recorded; screenshots are uploaded then linked as evidence                           |
| `run_checks` | `{ names?: string[] }`                                                                                           | Runs the recipe's trusted checks and records each as gate evidence                             |
| `confidence` | `{ level: "high" \| "medium" \| "low", reasons?: string[], uncertainties?: string[] }`                           | Stores the self-assessment; anything below `high` hands the PR to a human                      |
| `review`     | `{ verdict: "approve" \| "request_changes", summary, findings: [{severity, category?, file?, line?, message}] }` | Reviewer-only: records the independent review once                                             |

`review` is available only to the read-only reviewer session; the implementer's tool server
rejects it. `evidence` screenshots must be inside the worktree and PNG, JPEG or WebP.

---

## 6. GitHub webhook

`POST /api/webhooks/github` receives every GitHub App delivery. It is synchronous only for
verification, storage and acknowledgement; processing happens after the response so GitHub's
10-second delivery timeout is never a problem.

**Headers.**

| Header                | Required | Notes                                        |
| --------------------- | -------- | -------------------------------------------- |
| `x-github-event`      | yes      | For example `issues`, `pull_request`, `push` |
| `x-github-delivery`   | yes      | Unique delivery ID; used for idempotency     |
| `x-hub-signature-256` | yes      | `sha256=<hex HMAC-SHA256 of the raw body>`   |
| `content-type`        | no       | The body is parsed as JSON regardless        |

The signature is verified with `GITHUB_WEBHOOK_SECRET`. The same path and signature scheme apply
to GitHub Enterprise Server — only the GitHub host changes.

**Responses.**

| Status | Body                                                                     | When                                                    |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `202`  | `{ "ok": true, "duplicate": false }`                                     | Accepted; processing scheduled                          |
| `202`  | `{ "ok": true, "duplicate": true }`                                      | Same `x-github-delivery` already stored; ignored        |
| `400`  | `{ "error": "missing GitHub headers" }` or `{ "error": "invalid JSON" }` | Missing event/delivery headers, or the body is not JSON |
| `401`  | `{ "error": "bad signature" }`                                           | Signature does not match the raw body                   |
| `500`  | `{ "error": "GITHUB_WEBHOOK_SECRET is not set" }`                        | Server misconfiguration                                 |

**Delivery semantics.** Deliveries are stored in `webhook_inbox`, keyed by
`(provider, delivery_id)`, so a GitHub retry is a no-op. A processing failure is recorded with its
error and attempt count; the background worker retries unprocessed deliveries up to **5 attempts**.
The raw payload is kept for diagnosis. Unhandled event types are stored and ignored.

**Events Foundry acts on.**

| Event                                | Action(s)                   | Effect                                                                                                                                                |
| ------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issues`                             | `labeled`                   | A `foundry` label creates a job for the issue (at most one live job per issue)                                                                        |
| `issues`                             | `closed`                    | Cancels the job, unless it is already at `pr_ci`                                                                                                      |
| `issue_comment`                      | `created`                   | `/foundry cancel`, `/foundry retry` or `/foundry <message>` from a team member acts on the job; any other non-bot comment answers a `needs_input` job |
| `issue_comment`                      | `edited`                    | A question checkbox tick (the bot comment was edited by a human) answers the question                                                                 |
| `pull_request`                       | `closed`                    | Merged marks the job merged; closed unmerged cancels it; a revert marks the original merged job reverted                                              |
| `pull_request_review`                | `submitted`                 | A human `changes_requested` review re-opens work; others re-evaluate the gate at `pr_ci`                                                              |
| `check_suite`, `check_run`, `status` | `completed` (`status`: any) | For jobs at that SHA in `pr_ci`: starts the automatic PR review when enabled, otherwise re-evaluates the gate                                          |
| `push`                               | —                           | On the default branch, refreshes repo config when `.foundry/` changed or no recipe is known                                                           |
| `installation`                       | `deleted`                   | Removes the installation's repos                                                                                                                      |
| `installation_repositories`          | `added`/removed             | Links or unlinks repos, and links a known installation to its team                                                                                    |
| any other event                      | —                           | Stored, then ignored                                                                                                                                  |

For local development, `pnpm dev:webhooks` forwards deliveries from smee.io to this path.

---

## 7. Changing a contract

The shared schemas are the single source of truth. A contract change touches all of:

| Layer                | Where                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Schema               | `packages/shared/src/api.ts`, `packages/shared/src/events.ts`                                             |
| Control-plane route  | `apps/web/src/app/api/**/route.ts`; error mapping and `runnerRoute()` in `apps/web/src/server/http.ts`    |
| Control-plane logic  | `packages/control/src/runner-api.ts`, `packages/control/src/runners.ts`, `packages/control/src/ingest.ts` |
| Runner client        | `apps/runner/src/api.ts` (the `ControlPlane` interface is the seam used by tests)                         |
| Runner tool handlers | `apps/runner/src/job-runner.ts`, `apps/runner/src/tool-server.ts`                                         |
| MCP tool surface     | `packages/mcp-foundry/src/server.ts`, `packages/mcp-foundry/src/bridge.ts`                                |
| Tests                | `tests/api/*.test.ts`, `tests/e2e/*.test.ts`, colocated `*.test.ts`                                       |
| This document        | `docs/api.md` and `docs/api.zh-CN.md`                                                                     |

Rules of thumb:

- Validate at the boundary, not deep in a service: routes parse, control functions decide.
- Keep per-job calls owner-checked through `ownedJob()`; a runner that lost a job must get `409`
  so it stops the harness.
- Never put an installation token, runner token, join token or `FOUNDRY_SECRET` in a URL that is
  logged. Artifact URLs are the deliberate exception (signed, scoped, expiring) because PR
  screenshots must render without a session.
- Job status edges live in `packages/shared/src/states.ts`; do not add one in a handler.
