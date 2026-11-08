# Foundry — Component Solution Design

> 中文版本: [components.zh-CN.md](components.zh-CN.md)

Status: current implementation · Last reviewed: 2026-11-08

This document describes every runtime component and workspace package: what it owns, its main
modules, the interfaces it exposes or consumes, where its state lives, how it fails, and how it is
tested. Read [`overall-design.md`](overall-design.md) first for the system context.

---

## 1. Component map

| Component                      | Kind               | Owns                                                                          | Runs where                 |
| ------------------------------ | ------------------ | ----------------------------------------------------------------------------- | -------------------------- |
| `apps/web`                     | Next.js app        | Panel UI, Auth.js, webhook ingest, runner API, panel APIs, in-process worker  | Control-plane host         |
| `apps/realtime`                | Node service       | Postgres LISTEN → per-team WebSocket fan-out                                  | Control-plane host         |
| `apps/runner`                  | CLI + daemon       | Join, heartbeat, claim, worktrees, harness driving, checks, local state       | Team machine               |
| `packages/control`             | Library            | Control-plane business rules and services                                     | Inside `apps/web` or tests |
| `packages/db`                  | Library            | Drizzle schema, migrations, triggers, metrics views                           | Control plane              |
| `packages/shared`              | Library            | Zod contracts, job states, scheduling, gate, recipe/policy, tokens, rendering | Both sides                 |
| `packages/github`              | Library            | GitHub App client, webhook verification, in-memory fake                       | Control plane, tests       |
| `packages/harness-core`        | Library            | Harness adapter interface, event queue, transcript logging, fake              | Runner, tests              |
| `packages/harness-claude-code` | Library            | Claude Agent SDK adapter and message normalizer                               | Runner                     |
| `packages/harness-opencode`    | Library            | `opencode serve` adapter, event mapper, config generator                      | Runner                     |
| `packages/mcp-foundry`         | Library + CLI mode | Per-job MCP tools and runner bridge                                           | Harness subprocess         |
| `packages/os-adapters`         | Library            | OS-specific services, secrets, power, limits, process trees                   | Runner                     |
| `packages/playbooks`           | Library            | Built-in playbooks, prompt assembly, nudge/verify messages                    | Runner                     |
| `deploy/` + `packaging/`       | Config             | Compose stack, Caddy, Dockerfiles, release artifacts                          | Deployment                 |

---

## 2. `apps/web` — control plane

### 2.1 Role

The public entry point: panel pages, GitHub OAuth, webhook ingest, the runner HTTP API, panel APIs,
artifact serving, and the background worker that reconciles missed events.

### 2.2 Modules

| Area         | Files                                                                                                        | Responsibility                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Auth         | `src/auth.ts`, `src/server/session.ts`                                                                       | Auth.js GitHub provider, JWT sessions, `requireTeam()` / `requireAdmin()`.                            |
| Context      | `src/server/context.ts`                                                                                      | Builds one `ControlContext` from the database, GitHub client, notifier and env; injectable for tests. |
| HTTP helpers | `src/server/http.ts`                                                                                         | JSON/error mapping and `runnerRoute()`: bearer auth, zod body, typed errors.                          |
| Proxy        | `src/server/retry-fetch.ts`, `src/instrumentation.node.ts`                                                   | Wraps global fetch through `FOUNDRY_HTTP_PROXY` with retries; starts the worker once.                 |
| Panel pages  | `src/app/(panel)/**`                                                                                         | Inbox, board, job detail, repos, runners, metrics, settings, team.                                    |
| Actions      | `src/app/actions.ts`                                                                                         | Server actions for panel buttons (answer, retry, cancel, merge, settings).                            |
| Webhook      | `src/app/api/webhooks/github/route.ts`                                                                       | Verify signature, store delivery, process asynchronously.                                             |
| Runner API   | `src/app/api/runner/**`                                                                                      | Join, heartbeat, claim, readiness, git token, artifacts, per-job actions.                             |
| Panel API    | `src/app/api/jobs/[id]/events`, `realtime-token`, `push/subscribe`, `artifacts/[id]`, `github/setup`, `auth` | Live log, WebSocket token, push subscription, signed artifact download, App install callback, OAuth.  |
| Installer    | `src/app/install.sh/route.ts`                                                                                | Serves the runner install script.                                                                     |

### 2.3 Interfaces

**Runner API** (authenticated by `Authorization: Bearer <runnerToken>`):

| Method/path                         | Purpose                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/runner/join`             | Exchange a signed join token for a runner token; creates/replaces the runner row.                       |
| `POST /api/runner/heartbeat`        | Report resources, harnesses, running jobs; receive realtime token, repos, revocations, per-job limits.  |
| `POST /api/runner/claim`            | Atomically claim the best eligible job.                                                                 |
| `POST /api/runner/readiness`        | Report per-repo recipe readiness for the current recipe SHA.                                            |
| `POST /api/runner/git-token`        | Short-lived installation token for fetch/push.                                                          |
| `POST /api/runner/artifacts`        | Raw screenshot/note upload (≤ 10 MB).                                                                   |
| `POST /api/runner/jobs/:id/:action` | `events`, `stage`, `ask`, `evidence`, `confidence`, `plan`, `checkpoint`, `pr`, `onboarding`, `inputs`. |

Panel APIs are authenticated by the Auth.js session and scoped to the selected team.

### 2.4 Failure behavior

- Webhook processing is acknowledged with `202` before dispatch; failures stay in
  `webhook_inbox` and are retried by the worker.
- A missing `FOUNDRY_SECRET` or `DATABASE_URL` disables the worker instead of blocking the build.
- GitHub and notification failures are "best effort": logged, never allowed to corrupt job state.
- Unknown runner actions return `404`; illegal job transitions return `409`.
- The panel reads through the control context, so it works against the same code path as tests.

### 2.5 Tests

`tests/api/*.test.ts` imports route handlers and injects a test context with `setContextForTests`.
`tests/e2e/job.test.ts` drives a real daemon in-process. `tests/playwright/signin.spec.ts` checks
the public sign-in page. Component logic is covered in `packages/control/src/control.test.ts`.

---

## 3. `apps/realtime` — change fan-out

### 3.1 Role

Turn one Postgres `LISTEN foundry_changes` connection into per-team WebSocket messages, without
letting clients read each other's events.

### 3.2 Design

- `startRealtime({ sql, secret, port })` opens an HTTP server and a `ws` server with
  `noServer: true`.
- A client authenticates with a signed token in `?token=` or as the second WebSocket subprotocol
  (`["foundry", token]`). Claims must include `teamId`.
- The server sends `{type:"hello", teamId}` on connect, then
  `{type:"change", table, id, op, columns}` for changes in that team.
- A 25-second ping/pong loop drops dead clients and clients whose token expired.
- Messages carry only identifiers; clients refetch rows through the authenticated API.
- `GET /healthz` returns `ok`; other HTTP requests get `426 WebSocket only`.

### 3.3 Failure behavior

- No Postgres URL: the server still accepts connections but broadcasts nothing (useful for health
  and tests).
- Malformed NOTIFY payloads are ignored.
- WebSocket errors or closes remove the client; token expiry forces a reconnect with a fresh token.
- The service is stateless, so restarts are safe.

### 3.4 Tests

`apps/realtime/src/server.test.ts` covers token auth, team filtering, ping/expiry and health.

---

## 4. `apps/runner` — execution agent

### 4.1 Role

A long-lived daemon that claims jobs for its team, executes them in isolated worktrees, and reports
progress. It never lets the agent push code; the runner owns git.

### 4.2 CLI surface

`foundry runner join|start|install-service|uninstall-service|status|schedule`, plus
`foundry check`, `foundry doctor`, `foundry open`, `foundry mcp` and `--version`. In development the
same commands run as `bun apps/runner/src/cli.ts …`. Harnesses re-invoke the current executable
(`process.execPath`) with `mcp` to start the MCP server.

### 4.3 Modules

| Module           | Responsibility                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli.ts`         | Argument parsing, join, service install, status, schedule, doctor, MCP entry.                                                              |
| `config.ts`      | `~/.foundry/config.json` (or `--home`): server URL, runner ID, name, kind, concurrency, schedule, disk floor, Postgres URL, limits, proxy. |
| `daemon.ts`      | Heartbeat, accepting gating (draining, disk, AC power, idle, windows), claim loop, realtime socket, sleep inhibitor, hourly GC.            |
| `job-runner.ts`  | Per-job state machine: setup, harness session, stage enforcement, MCP tools, verify loop, PR/onboarding, checkpoints, cleanup.             |
| `workspace.ts`   | Bare mirror per repo, `git worktree` per job, detached readiness worktree, commit/diff/push.                                               |
| `git.ts`         | Spawns git with proxy args, installation token in `http.extraheader`, transient retry, workflow-permission hint.                           |
| `checks.ts`      | Runs commands through `sh -c` (or PowerShell), detached process groups, timeout kill-tree, output tail.                                    |
| `readiness.ts`   | OS/system-dep preflight, then runs warm/install/checks in a detached worktree; caps a pass at 20 minutes.                                  |
| `services.ts`    | Creates/drops a per-job Postgres database and exports `DATABASE_URL`.                                                                      |
| `ports.ts`       | Leases a 10-port block from 41000, persisted in `ports.json`.                                                                              |
| `tool-server.ts` | Local HTTP server on a Unix socket (or loopback TCP), per-job tool token.                                                                  |
| `state.ts`       | Local job records and the harness transcript path.                                                                                         |
| `brief.ts`       | Pushes/reads the handoff brief to/from a git ref.                                                                                          |
| `scrub.ts`       | Exact-value and pattern redaction.                                                                                                         |
| `gc.ts`          | Removes finished/stale worktrees, ports and local records.                                                                                 |
| `smoke.ts`       | `doctor --live` minimal harness session.                                                                                                   |

### 4.4 Job execution contract

1. Resolve the harness; fail if it is not available on this machine.
2. Create or reuse the worktree (sticky resume reuses the local one), lease a port block.
3. Load `.foundry/recipe.yaml` and `policy.yaml`; compute effective time/cost limits.
4. Provision per-job services and build the job env (`FOUNDRY_JOB_ID`, `FOUNDRY_PORT`,
   `FOUNDRY_PORT_END`, `FOUNDRY_BRANCH`, proxy vars, per-job secrets).
5. Run `install` unless this is a sticky resume.
6. Start the harness with the assembled playbook, the pending inputs and the `foundry` MCP server.
7. Consume events; enforce the cost cap as usage arrives.
8. Handle tools:
   - `stage(name)` enforces the next stage in order and checkpoints on transition.
   - `plan(text)` stores the plan.
   - `ask(question, options)` parks the job after a grace period.
   - `evidence(...)` stores notes or uploads screenshots.
   - `run_checks(names)` runs trusted recipe checks and records evidence.
   - `confidence(...)` stores the self-assessment.
9. On `stage(done)`, re-run checks against the exact tree, commit, compute the diff, require at
   least one changed file, capture a screenshot when UI paths changed, push, and ask the control
   plane to open the PR.
10. Clean up: release the harness, remove the worktree unless parked, release ports, drop services.

### 4.5 Failure behavior

- Any `FailJob` is reported as `failed` with a scrubbed reason; the harness transcript keeps the
  full local detail.
- A revoked job (HTTP 409) stops the harness and leaves state to the control plane.
- A checkpoint push failure is logged but does not fail the job.
- Budget overruns stop the harness and fail with the budget reason.
- `SIGINT`/`SIGTERM` hand running jobs back to the queue after a checkpoint.

### 4.6 Tests

Unit tests colocate with modules (`daemon.test.ts`, `job-runner.test.ts`, `workspace.test.ts`,
`readiness.test.ts`, `git.test.ts`, `checks.test.ts`, `ports.test.ts`, `gc.test.ts`,
`config.test.ts`, `api.test.ts`). They use git fixtures under `file://`, `FakeHarness` and a
recording control plane. `tests/e2e/job.test.ts` runs the full loop in-process.

---

## 5. `packages/shared` — contracts and pure rules

### 5.1 Role

The single definition of the vocabulary used on both sides of the wire. It has no database,
network or process dependencies.

### 5.2 Modules

| Module              | Contents                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `states.ts`         | `JOB_STATUSES`, `RUNNER_STAGES`, transition table, labels, titles, job kinds.                                          |
| `events.ts`         | Discriminated union of every job event (`stage_changed`, `usage`, `question`, `gate`, …).                              |
| `api.ts`            | Zod schemas for join, heartbeat, claim, stage, ask, evidence, confidence, plan, checkpoint, PR, onboarding, readiness. |
| `recipe.ts`         | `RecipeSchema` (install, checks, dev server, services, env file, system deps, warm, OS, UI paths).                     |
| `policy.ts`         | `PolicySchema` (merge mode, CI/AI review requirements, loop/cost/diff limits, risk rules, permissions).                |
| `gate.ts`           | `evaluateGate()` implementing the confidence gate.                                                                     |
| `risk.ts`           | Path glob/regex risk matching, UI-change detection, reviewer splitting.                                                |
| `diff.ts`           | Unified-diff and GitHub-file diff parsing, changed-line counts.                                                        |
| `scheduler.ts`      | Heartbeat/sticky constants, eligibility, runner ranking, local schedule evaluation.                                    |
| `tokens.ts`         | HMAC sign/verify, random tokens, SHA-256.                                                                              |
| `comments.ts`       | Question/status/PR rendering, checkbox and reply parsing, `/foundry` command parsing.                                  |
| `brief.ts`          | Handoff brief schema, ref naming, Markdown rendering/parsing.                                                          |
| `notify.ts`         | Outgoing webhook payload builder and one-line notification text.                                                       |
| `pricing.ts`        | Token-cost fallback table.                                                                                             |
| `proxy.ts`          | Proxy resolution, localhost exclusion, env injection, git proxy args.                                                  |
| `github-host.ts`    | GitHub.com vs GHES URL derivation and env-file loading.                                                                |
| `install-script.ts` | The `curl                                                                                                              | sh` installer template. |
| `ticket.ts`         | Issue-section parsing (Goal, Acceptance criteria, Constraints, Out of scope).                                          |
| `version.ts`        | Runner/product version string.                                                                                         |

### 5.3 Tests

Pure unit tests for state transitions, gate rules, policy/recipe parsing, scheduler ranking, token
verification, proxy behavior, risk matching, diff parsing and comment rendering.

---

## 6. `packages/db` — persistence

### 6.1 Role

Postgres schema, migrations, NOTIFY triggers and reporting views. It exposes Drizzle models and a
database factory; it contains no business decisions.

### 6.2 Modules

| Module                          | Responsibility                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`                     | All tables and indexes (teams, users, repos, runners, readiness, jobs, events, questions, inputs, evidence, artifacts, webhook inbox, notifications). |
| `migrations/`                   | Ordered SQL migrations, including NOTIFY triggers and `metrics_*` views.                                                                              |
| `migrate.ts` / `migrate-cli.ts` | Applies migrations; used by `pnpm db:migrate` and the compose `migrate` service.                                                                      |
| `index.ts`                      | `getDatabase()` and exported row types.                                                                                                               |
| `testing.ts`                    | Throwaway-database helpers for API tests.                                                                                                             |

### 6.3 Notable constraints

- Every table is scoped to a team directly or through its job/repo.
- `webhook_inbox` has a unique `(provider, delivery_id)` key; job/issue uniqueness is enforced by a
  partial unique index so one issue has at most one live job.
- Events are append-only and indexed by `(job_id, id)` and `(team_id, ts)`.
- Timestamps are `timestamptz`; application code passes ISO strings to nested SQL fragments.
- Reporting views keep metrics queries out of the hot path.

---

## 7. `packages/control` — control-plane business rules

### 7.1 Role

Every rule the control plane owns, written against a `ControlContext`:

```ts
interface ControlContext {
  db: Db;
  sql: Sql;
  gh: GitHubClient;
  notifier: Notifier;
  publicUrl: string;
  realtimeUrl: string;
  secret: string;
  now(): Date;
  log(message: string, extra?: Record<string, unknown>): void;
}
```

### 7.2 Modules

| Module           | Responsibility                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingest.ts`      | Idempotent webhook storage, dispatch by event type, retry of pending deliveries.                                                                  |
| `jobs.ts`        | Get/transition jobs, create jobs from issues, record events and usage, queue human input, send messages, cancel, retry, reconcile labeled issues. |
| `claim.ts`       | Scheduler snapshot, atomic claim with `SKIP LOCKED`, resume-mode selection, spend cap, queue diagnosis.                                           |
| `runner-api.ts`  | Authenticated per-job actions: events, stage, ask, evidence, confidence, plan, checkpoint, inputs, git token; ownership checks.                   |
| `merge-gate.ts`  | Latest evidence, gate evaluation, auto-merge, handover with reviewers, merged/changes-requested reconciliation.                                   |
| `prs.ts`         | Open or refresh the PR, render its body from plan/evidence/confidence, transition to `pr_ci`, evaluate the gate.                                  |
| `onboarding.ts`  | Start/restart onboarding, complete it by opening the recipe PR or failing.                                                                        |
| `questions.ts`   | Ask a question, answer from panel/checkbox/reply, update the GitHub comment, re-queue when all open questions are answered.                       |
| `repos.ts`       | Refresh cached `.foundry/` files, parse recipe/policy, effective merge mode, repo settings.                                                       |
| `teams.ts`       | Users, teams, memberships, invites, installation linking and unlinking.                                                                           |
| `runners.ts`     | Join tokens, runner authentication, heartbeat, readiness, drain/remove, team runners.                                                             |
| `github-sync.ts` | One status comment per job, exactly one `foundry:<stage>` label, optional Projects status.                                                        |
| `notify.ts`      | Channel notifier (webhook/email/push/digest), recipients, delivery log.                                                                           |
| `sweeper.ts`     | Re-queue jobs from runners that stopped heartbeating.                                                                                             |
| `worker.ts`      | 30-second loop over webhook retry, PR/review/issue reconciliation, sweeper and digest.                                                            |
| `artifacts.ts`   | Store artifacts on disk and mint signed URLs.                                                                                                     |
| `metrics.ts`     | Team metrics and the capacity card from the reporting views/events.                                                                               |
| `queries.ts`     | Read models for the panel (inbox, board, job detail, repos, runners, metrics).                                                                    |
| `context.ts`     | Context type, job URL helper, best-effort side effects.                                                                                           |
| `testing.ts`     | `createTestEnv`, fake seeding, `TEST_RECIPE`.                                                                                                     |

### 7.3 Failure behavior

- GitHub and notification calls are best-effort; the job state is committed first.
- `transitionJob` locks the row, validates the edge and only then writes the event and syncs GitHub.
- `claimJob` returns `null` rather than throwing when the runner is not eligible.
- `ownedJob` rejects actions from a runner that no longer holds the job (`409` → runner stops).
- Webhook processing records the error and attempt count; the worker retries.

---

## 8. `packages/github` — GitHub App client

### 8.1 Role

A narrow interface over the GitHub REST/GraphQL API used by the control plane, plus a faithful
in-memory fake for tests.

### 8.2 Modules

| Module        | Responsibility                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | `GitHubClient`, `RepoRef`, issues, PRs, reviews, installations, CI state.                                                                                     |
| `octokit.ts`  | `OctokitGitHubClient`: App auth, cached installation Octokits, issues, comments, labels, files, PRs, reviews, reviewers, merge, CI state, Projects v2 status. |
| `webhooks.ts` | `verifyWebhookSignature` (HMAC SHA-256).                                                                                                                      |
| `fake.ts`     | `FakeGitHub` with recorded calls, merge/CI/review controls and webhook signing helpers.                                                                       |

### 8.3 Design notes

- `resolve fetch` is called at request time so the web app's proxy wrapper is honored.
- Installation Octokits are cached for 30 minutes; app-level calls sign a JWT locally.
- `combineCi` merges check runs and commit statuses, with required checks defaulting to pending.
- 404s are treated as "absent" for optional resources (labels, files, branches, comments).
- GHES uses derived `/api/v3` and `/api/graphql` bases from `GITHUB_HOST`.

### 8.4 Tests

`github.test.ts` covers the fake; `octokit.mock.test.ts` covers the real client with undici
`MockAgent` (global dispatcher, disabled network, persisted installation-token endpoint).

---

## 9. Harness adapters

### 9.1 `packages/harness-core`

The contract every harness implements:

```ts
interface HarnessAdapter {
  id: "claude-code" | "opencode";
  detect(): Promise<{ installed: boolean; version?: string; authOk: boolean }>;
  start(opts: StartOpts): Promise<HarnessSession>;
  resume(sessionId: string, message: string, opts: ResumeOpts): Promise<HarnessSession>;
  stop(session: HarnessSession): Promise<void>;
  release?(cwd: string): Promise<void>;
}
```

`StartOpts` carries the worktree, model, system prompt, prompt, env, MCP servers, permissions,
optional harness port, transcript path and redactor. A session exposes a native ID promise,
normalized events and a `done` result. The package also provides `AsyncQueue`, `deferred`,
transcript logging and `FakeHarness`.

### 9.2 `packages/harness-claude-code`

- Uses `@anthropic-ai/claude-agent-sdk` in-process. A compiled runner points the SDK at the
  installed `claude` CLI (`FOUNDRY_CLAUDE_PATH` first); from source the SDK's engine is used.
- Loads only project settings (`settingSources: ["project"]`) but merges the `env` block from
  `~/.claude/settings.json` so provider keys and base URLs keep working.
- Translates policy into `disallowedTools` and a `canUseTool` handler; denied shell commands are
  refused with an explanation.
- `normalize.ts` maps SDK messages to Foundry events: messages, tool calls, subagents, usage and
  errors. Cost comes from the SDK result message.
- Resume uses `resume: <sessionId>`; cost is tracked per native session.

### 9.3 `packages/harness-opencode`

- Spawns `opencode serve` in the worktree on the job's leased harness port, with
  `OPENCODE_CONFIG_CONTENT` generated from the MCP servers, permissions and model.
- Readiness is an HTTP 2xx from `/config`, not just a listening socket (the router starts later).
- Creates or reuses a session and sends prompts with `session.promptAsync`.
- `events.ts` maps the OpenCode event stream to Foundry events exactly once per text part, tool
  call and step; it records provider retries and fails after three.
- Cost is taken from `step-finish` when the provider reports it, otherwise from the shared price
  table.
- The server stays up between turns; `release(cwd)` kills it when the job is done.

### 9.4 Tests

`harness-core.test.ts` covers the queue/fake. Claude tests cover normalization and policy mapping.
OpenCode tests cover event mapping, config generation, and (when `opencode` is on PATH) a live
server session that is skipped otherwise.

---

## 10. `packages/mcp-foundry` — per-job MCP server

### 10.1 Role

Give the agent an explicit, harness-neutral progress API:

| Tool         | Effect                                                                |
| ------------ | --------------------------------------------------------------------- |
| `stage`      | Move to the next playbook stage; `done` triggers verification and PR. |
| `plan`       | Store the implementation plan.                                        |
| `ask`        | Ask the ticket author one decision and park the job.                  |
| `evidence`   | Attach a screenshot (PNG/JPEG/WebP inside the worktree) or a note.    |
| `run_checks` | Run recipe checks; results become gate evidence.                      |
| `confidence` | Report high/medium/low and open uncertainties.                        |

### 10.2 Design

- `createFoundryMcpServer(bridge)` registers the tools with the MCP SDK; every call is forwarded
  to a `ToolBridge`.
- `bridgeFromEnv()` resolves the runner endpoint from `FOUNDRY_MCP_SOCKET` or `FOUNDRY_MCP_URL` plus
  `FOUNDRY_JOB_ID` and `FOUNDRY_MCP_TOKEN`.
- The runner's `ToolServer` authenticates the per-job token so one job cannot report on another.
- `foundry mcp` is the stdio entry point; in development it runs from source, in a release it is
  the compiled binary invoking itself.

### 10.3 Failure behavior

If the runner is unreachable, the tool returns an MCP error text; the agent can retry or report
low confidence. The runner never trusts a tool call that claims another job.

---

## 11. `packages/os-adapters` — platform differences

### 11.1 Role

Keep every OS-specific action behind one interface:

```ts
interface OsAdapter {
  os: "macos" | "linux" | "windows";
  info(): Promise<MachineInfo>;
  diskFreeMb(path: string): Promise<number>;
  onAcPower(): Promise<boolean | null>;
  idleSeconds(): Promise<number | null>;
  inhibitSleep(reason: string): Promise<SleepInhibitor>;
  service(spec: ServiceSpec): ServiceInstall;
  createUserCommands(user: string, home: string): string[][];
  secrets(): Promise<SecretStore>;
  wrapWithLimits(argv: string[], limits: ResourceLimits): Promise<string[]>;
}
```

### 11.2 Implementations

| Concern         | macOS                                   | Linux                                        | Windows                                          |
| --------------- | --------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Service         | launchd plist per runner name           | systemd user/system unit per runner name     | Startup `.cmd`                                   |
| Secrets         | Keychain (file store for a custom home) | `systemd-creds` (root) or `0600` file        | `0600` file                                      |
| Power           | `pmset -g batt`                         | `/sys/class/power_supply`                    | `Get-CimInstance Win32_Battery`                  |
| Idle            | `ioreg` HID idle time                   | `loginctl` idle hints                        | not implemented (returns `null`)                 |
| Sleep inhibitor | `caffeinate -i -w <pid>`                | `systemd-inhibit`                            | `SetThreadExecutionState` via PowerShell         |
| Limits          | `nice` (best effort)                    | `systemd-run --scope` cgroups when available | none (timeout/kill)                              |
| Process tree    | `killTree` using process groups         | same                                         | `taskkill /T` behavior through the shared helper |

`exec.ts` provides promise-based command execution, disk-free and `which` helpers; `home.ts`
resolves `FOUNDRY_HOME` and custom homes; `service-names.ts` normalizes names into service-safe
slugs.

### 11.3 Tests

`os.test.ts` and `windows.test.ts` cover unit parsing of `pmset`, `ioreg`, `loginctl`, power
supplies, launchd/systemd rendering and Windows scripts without touching the host.

---

## 12. `packages/playbooks` — how the agent is instructed

### 12.1 Role

Own the text that turns a ticket into a staged playbook and assembles the system prompt.

### 12.2 Contents

- Built-ins: `default` (triage → investigate → implement → verify), `bugfix`, `feature`,
  `onboarding`.
- Repo overrides: `.foundry/playbook.md`, `.foundry/playbook.<name>.md`, and per-harness notes
  `.foundry/playbook.<harness>.md`; `.foundry/skills/*.md` are appended as repo knowledge.
- `assemblePrompt()` builds the system prompt and the first user message, including the ticket,
  acceptance-criteria note, a portable-resume brief and pending human inputs.
- `resumeMessage()`, `NUDGE_MESSAGE` and `verifyFailedMessage()` standardize what the agent sees
  after a pause, an early stop or a failed verify loop.

### 12.3 Design notes

- Markdown is imported with `with { type: "text" }`; Vitest mirrors that with a transform.
- Playbooks are plain Markdown so a repo can replace them without code changes.
- The runner enforces stage order independently; a playbook cannot skip stages.

---

## 13. `deploy/` and `packaging/` — shipping

### 13.1 `deploy/`

- `compose.yaml`: Postgres, one-shot migrations, web, realtime, Caddy; named volumes for database,
  artifacts and Caddy state; `github-app.pem` bind mount.
- `Caddyfile`: proxy `/realtime*` to realtime, everything else to web, gzip enabled.
- `apps/web/Dockerfile`: deps → build → standalone web; a `migrate` target for the one-shot job.
- `apps/realtime/Dockerfile`: installs only the realtime workspace and starts it.

### 13.2 `packaging/`

- `apps/runner/scripts/build-release.ts` compiles `foundry` for darwin/linux/windows on x64/arm64,
  writes tarballs, `SHA256SUMS`, `install.sh`, a Homebrew formula and (when `nfpm` exists) `.deb` /
  `.rpm` packages.
- `packaging/homebrew/foundry.rb.tmpl` and `packaging/linux/postinstall.sh` tell the user to join
  and install the service explicitly; installing never starts work by itself.

### 13.3 Release contract

One executable per platform, versioned with `VERSION`; artifacts are reproducible from CI, and the
Homebrew/Linux installers resolve the matching tarball by OS and architecture.

---

## 14. Cross-component contracts

| Contract                     | Owner                                         | Consumers                               |
| ---------------------------- | --------------------------------------------- | --------------------------------------- |
| Job statuses and transitions | `packages/shared/states.ts`                   | control, runner, panel, GitHub labels   |
| Event union                  | `packages/shared/events.ts`                   | runner, control, panel                  |
| Runner API schemas           | `packages/shared/api.ts`                      | runner HTTP client, web routes, control |
| Recipe and policy schemas    | `packages/shared/recipe.ts`, `policy.ts`      | runner, control, onboarding, readiness  |
| Gate input/output            | `packages/shared/gate.ts`                     | control merge gate, tests               |
| Harness adapter              | `packages/harness-core`                       | runner, Claude/OpenCode adapters, tests |
| MCP tool surface             | `packages/mcp-foundry`                        | agent, runner tool server               |
| Handoff brief                | `packages/shared/brief.ts`                    | runner checkpoint/resume                |
| Realtime message             | `apps/realtime` + `packages/shared/tokens.ts` | panel, runner daemon                    |

## 15. How to change a component

1. Change the smallest package that owns the rule; do not put business logic in a route handler.
2. If a cross-component contract changes, update `packages/shared` first, then both consumers.
3. Add a unit test beside the module; add an API/e2e test when a boundary is involved.
4. Update this document and `overall-design.md` when behavior or a boundary changes, in both
   languages.
