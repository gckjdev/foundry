# runner/src

## Overview

The runner is a daemon plus a one-shot job driver. The daemon (`daemon.ts`)
heartbeats, applies draining/revocation/budget-limit updates, triggers repo
readiness passes, and claims jobs while the local schedule, disk, and
concurrency allow. Each claimed job is driven by `JobRunner` in its own git
worktree, with the agent talking to the runner through a per-job MCP tool
server. Supporting modules handle git, mirrors/worktrees, ports, services,
secret scrubbing, playbook/repo files, and the CLI.

## Interface

- Control plane client: `ControlPlane`, `HttpControlPlane`, `joinControlPlane`, `JobRevokedError`, `ApiError` ([api.ts]).
- Daemon: `Daemon`, `DaemonOptions` ([daemon.ts:Daemon]); `start`, `stop`, `tick`, `claimLoop`, `status` ([daemon.ts]).
- Job driver: `JobRunner`, `JobRunnerDeps`, `JobOutcome` (`pr_opened | onboarded | pr_reviewed | needs_input | paused | failed | revoked`), `pause`, `revoke`, `run`, `setMaxJobMinutes`, `setMaxCostUsd` ([job-runner.ts]).
- Git and checks: `runCommand`, `startCommand`, `shellArgv`, `tail`, `CommandResult`, `RunningCommand` ([checks.ts]); `git`, `gitOut`, `authArgs`, `gitFailureHint`, `gitRemoteUsesHttpProxy`, `GitError`, `GitResult` ([git.ts]).
- Workspace: `Workspace` (`ensureMirror`, `createWorktree`, `createDetachedWorktree`, `removeWorktree`, `commitAll`, `headSha`, `push`, `diffAgainstBase`, `readFileAt`, `readWorktreeFile`), `remoteUrl` ([workspace.ts]).
- Ports: `PortLeases`, `PORT_RANGE_START=41000`, `PORT_BLOCK=10`, `PORT_BLOCKS=200` ([ports.ts]).
- Persistent local state: `LocalJobs`, `LocalJob` (`running | parked`) ([state.ts]); config `loadConfig`, `saveConfig`, `applyRunnerHome`, `dataDir`, `RunnerConfigSchema`, `TOKEN_SECRET_KEY` ([config.ts]).
- Readiness: `checkRecipe`, `ReadinessReporter`, `depBinary`, `READINESS_TIMEOUT_MS` ([readiness.ts]).
- Repo inputs: `loadRecipe`, `loadPolicy`, `loadPlaybookFiles`, `RECIPE_FILE`, `POLICY_FILE` ([repo-files.ts]).
- Services: `provisionServices`, `dropServices`, `jobDatabaseName` ([services.ts]).
- Security: `scrub`, `secretEnvValues` ([scrub.ts]).
- Brief/parking: `pushBrief`, `fetchBrief` ([brief.ts]); `collectGarbage`, `PARKED_TTL_MS` ([gc.ts]).
- MCP bridge: `ToolServer`, `ToolHandler` ([tool-server.ts]); skills `installSkills`, `installedSkillNames`, `SKILL_DIRS` ([skills.ts]); harness factory `defaultHarnesses` ([harnesses.ts]); `smokeTest` ([smoke.ts]).
- CLI: `main`, `selfCommand` ([cli.ts]); `index.ts` re-exports `api`, `daemon`, `job-runner`, `ports`, `skills`, `state`, `testing`, `tool-server`, `workspace` ([index.ts:index]).
- Test doubles shipped for the e2e suite: `RecordingControlPlane`, `createGitFixture`, `claimedJob`, `TEST_RECIPE`, `agentTools`, `testSocketPath` ([testing.ts]).

## Invariants

- `git()` retries only network verbs (`fetch`, `push`, `clone`, `ls-remote`) up to 5 times on transient failures; interactive prompts are disabled (`GIT_TERMINAL_PROMPT=0`) ([git.ts:spawnGit]).
- Installation tokens are passed as `http.extraheader`, never in the remote URL or argv; `GitError` filters that argument from its message ([git.ts:authArgs], [git.ts:GitError]).
- `file://` git bases (test fixtures) bypass the HTTP proxy ([git.ts:gitRemoteUsesHttpProxy]).
- One bare mirror per repo and one worktree per job id; concurrent mirror fetches share one in-flight promise ([workspace.ts:Workspace]).
- Each job leases a block of 10 ports so concurrent dev servers cannot collide; leases survive a daemon restart in `ports.json` ([ports.ts:PortLeases]).
- The daemon never runs two `JobRunner`s for the same job id and ignores duplicate claims ([daemon.ts:claimLoop]).
- The tool server rejects any call whose token does not match the registered job token, and refuses a second registration for the same job ([tool-server.ts:register]).
- Everything leaving the machine (events, check output) is scrubbed of known env secrets and common token shapes ([scrub.ts:scrub], [job-runner.ts:scrubEvent]).
- Runner config is written `0o600`; the runner token lives in the OS secret store under `runner-token` ([config.ts:saveConfig], [cli.ts:requireConfig]).
- Readiness is paced: the full recipe may run for minutes but never blocks heartbeats, and only one pass runs at a time ([readiness.ts:ReadinessReporter], [daemon.ts:tick]).
- Per-job Postgres databases are named deterministically from the job id and dropped with `with (force)` ([services.ts:jobDatabaseName]).

## Side Effects

- Writes under `FOUNDRY_HOME`/`dataDir()`: `config.json`, `ports.json`, `status.json`, `jobs/*.json`, `jobs/*.harness.log`, mirrors, and worktrees ([config.ts], [state.ts], [workspace.ts], [daemon.ts:writeStatus]).
- Clones/fetches bare mirrors and creates/removes git worktrees; commits and force-pushes job branches; pushes the handoff brief to `refs/foundry/<job>/brief` ([workspace.ts], [brief.ts]).
- Spawns shell commands in detached process groups and kills the whole tree on timeout or stop ([checks.ts]).
- Calls the control plane over HTTP (heartbeat, claim, readiness, git-token, artifacts, events, stage/ask/evidence/confidence/plan/checkpoint/pr/onboarding/inputs/pr-review) ([api.ts]).
- Creates and drops per-job databases on the runner's own Postgres ([services.ts]).
- Binds a Unix socket (POSIX) or loopback TCP port (Windows) for the MCP bridge ([tool-server.ts]).
- Installs/removes launchd/systemd services and may inhibit sleep while jobs run ([cli.ts], [daemon.ts:updateInhibitor]).
- Installs built-in skills into `.claude/skills` and `.opencode/skills` ([skills.ts:installSkills]).

## Verification

- Run: `pnpm test`
