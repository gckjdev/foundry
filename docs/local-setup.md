# Configuration, install, and deploy

> 中文版本: [local-setup.zh-CN.md](local-setup.zh-CN.md)

This is the runbook for the Foundry control plane on this machine, plus how to deploy it. Secrets live only in gitignored `.env` and `github-app.pem` — never copy those values into git.

## What is running locally

| Piece              | How                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Web panel          | `http://localhost:3000` (`pnpm dev`)                                                           |
| Realtime WebSocket | `ws://localhost:3001`                                                                          |
| Postgres           | Anaconda PostgreSQL 17, data dir `~/pgdata`, port **54329** (not Docker; not started at login) |
| GitHub App         | [gckjdevfoundryapp](https://github.com/settings/apps/gckjdevfoundryapp)                        |
| Webhook tunnel     | `pnpm dev:webhooks` → smee.io → `/api/webhooks/github`                                         |
| Runner             | **not** started by `pnpm dev`; join a team first, then `pnpm dev:runner`                       |

Repo: `git@github.com:gckjdev/foundry.git`. Root `.env` is chmod 600. `apps/web/.env` and `apps/realtime/.env` are symlinks to `../../.env`.

## Prerequisites

- Node 22+, pnpm 10 (`packageManager` in root `package.json`)
- Postgres 16+
- Bun (runner / CLI only)
- A GitHub App you admin, plus its private key `.pem`
- Optional: `FOUNDRY_HTTP_PROXY` if this machine cannot reach GitHub or model APIs directly

## 1. GitHub App

Open **GitHub → Settings → Developer settings → GitHub Apps** (this instance: [gckjdevfoundryapp](https://github.com/settings/apps/gckjdevfoundryapp)).

### URLs (local)

Set these on the App, then change them when you deploy to a public host.

| Field        | Local value                                                            |
| ------------ | ---------------------------------------------------------------------- |
| Homepage URL | `http://localhost:3000`                                                |
| Callback URL | `http://localhost:3000/api/auth/callback/github`                       |
| Setup URL    | `http://localhost:3000/api/github/setup`                               |
| Webhook URL  | your smee channel, e.g. `https://smee.io/<id>` (must match `SMEE_URL`) |

Expire user authorization tokens can stay on. Identifying and authorizing users (OAuth) uses the App’s **Client ID** / **Client secret** as `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.

### Permissions

Repository:

- **Metadata** — Read
- **Contents** — Read and write
- **Issues** — Read and write
- **Pull requests** — Read and write
- **Checks** — Read (needed for the merge gate)
- **Commit statuses** — Read
- **Workflows** — Read and write (required to push changes under `.github/workflows/`; without it GitHub rejects the job branch)

After you add or change permissions, open the App's installation on the account (for this machine: [installation 179251611](https://github.com/settings/installations/179251611)) and **accept the new permissions**. Until you accept, tokens keep the old set and workflow-file pushes still fail.

Account:

- **Email addresses** — Read (Sign in with GitHub)

### Webhook events

Subscribe to: `installation`, `installation_repositories`, `push`, `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `check_suite`, `check_run`, `status`.

### Credentials to copy into `.env`

From the App page:

- **App ID** → `GITHUB_APP_ID` (this App is `5641757`)
- **Slug** in the URL → `GITHUB_APP_SLUG` (`gckjdevfoundryapp`)
- **Client ID** (`Iv23…`) → `AUTH_GITHUB_ID`
- **Client secret** → `AUTH_GITHUB_SECRET`
- **Webhook secret** → `GITHUB_WEBHOOK_SECRET`
- Generate a private key, save it as `github-app.pem` at the repo root (gitignored), set `GITHUB_APP_PRIVATE_KEY_PATH` to that absolute or repo-relative path

### GitHub Enterprise Server (GHES)

To point Foundry at a self-hosted GitHub Enterprise Server (GHES 3.12+) instead of github.com, set one host in `.env` and derive everything else from it:

```bash
GITHUB_HOST=https://github.example.com
```

Foundry then derives `https://github.example.com/api/v3` (REST), `https://github.example.com/api/graphql` (GraphQL/Projects v2), the OAuth authorize/token/userinfo endpoints, git remotes, the App install link, and issue/PR links. Leave `GITHUB_HOST` empty/unset for github.com (which keeps the special-cased `https://api.github.com` REST host). One control plane talks to one GitHub host.

- Create the GitHub App **on that GHES instance** (not github.com) and fill in the same App ID / slug / client ID / secret / private key / webhook secret as above. Use the same repository and account permissions as the github.com instructions; accept them on the installation after any change.
- The App's **Webhook URL** and OAuth **Callback URL** stay the same Foundry URLs (`https://<foundry>/api/webhooks/github` and `/api/auth/callback/github`). The webhook path and signature verification are unchanged.
- smee still works only if the GHES instance can reach the smee URL. If it cannot, use a webhook tunnel that GHES can call, or the public Foundry host's own `/api/webhooks/github`.
- GHES must present a certificate Node trusts. Foundry does **not** disable TLS verification; add your enterprise CA to the machine's trust store rather than setting `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- Optional overrides `GITHUB_API_URL` and `FOUNDRY_GIT_BASE` win over the derived values when set.
- GitHub Projects (v2) and some merge APIs may be absent on older GHES. Project status sync logs and skips on a 404 rather than failing the job.

## 2. Environment

```bash
cp .env.example .env
chmod 600 .env
ln -sfn ../../.env apps/web/.env
ln -sfn ../../.env apps/realtime/.env
```

Fill the file. This machine’s non-secret values:

```bash
DATABASE_URL=postgres://postgres@localhost:54329/foundry
FOUNDRY_PUBLIC_URL=http://localhost:3000
FOUNDRY_REALTIME_URL=ws://localhost:3001
GITHUB_APP_ID=5641757
GITHUB_APP_SLUG=gckjdevfoundryapp
GITHUB_APP_PRIVATE_KEY_PATH=/Users/pipi/foundry/github-app.pem
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
FOUNDRY_HTTP_PROXY=http://127.0.0.1:8118
# AUTH_GITHUB_ID / AUTH_GITHUB_SECRET / AUTH_SECRET / FOUNDRY_SECRET /
# GITHUB_WEBHOOK_SECRET / SMEE_URL / VAPID_*  → already in .env, do not commit
```

Generate long random values for `FOUNDRY_SECRET` and `AUTH_SECRET` if you start from `.env.example`.

Set `FOUNDRY_HTTP_PROXY` (for example `http://127.0.0.1:8118`) so **every** outbound HTTP call — GitHub OAuth/API, outgoing webhooks, git fetch/push, OpenCode/Claude model APIs — uses that proxy. Localhost (the panel, realtime, `opencode serve`) is excluded via `FOUNDRY_NO_PROXY`. If this is unset, Foundry still honors `HTTPS_PROXY`/`HTTP_PROXY`, then the macOS system proxy. Restart `pnpm dev` and `pnpm dev:runner` after changing it. The runner also stores `httpProxy` in `~/.foundry/config.json` on join (`--http-proxy` or this env var).

## 3. Local install

### Start Postgres

This machine has no Docker and no launchd/Homebrew service. Postgres is the Anaconda 17 build, cluster at `~/pgdata`, listening on **54329** so it matches `DATABASE_URL`. It does not start at login.

```bash
/opt/anaconda3/bin/pg_ctl -D "$HOME/pgdata" -l "$HOME/pgdata/server.log" -o "-p 54329" start
/opt/anaconda3/bin/pg_isready -h localhost -p 54329
```

Stop it with:

```bash
/opt/anaconda3/bin/pg_ctl -D "$HOME/pgdata" stop
```

The app role and database (already created on this machine):

```bash
/opt/anaconda3/bin/psql -h localhost -p 54329 -d postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER;"
/opt/anaconda3/bin/psql -h localhost -p 54329 -d postgres -c "CREATE DATABASE foundry OWNER postgres;"
```

`CREATE ROLE` / `CREATE DATABASE` fail with “already exists” once they are in place; that is fine. Tests need a URL that can `CREATE DATABASE`, on this server and **not** the `foundry` app database:

```bash
FOUNDRY_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres pnpm test
```

Then install and start the control plane:

```bash
pnpm install
pnpm db:migrate          # uses DATABASE_URL
pnpm dev                 # web :3000 + realtime :3001 only
```

In a second terminal, while developing against GitHub webhooks:

```bash
pnpm dev:webhooks        # loads SMEE_URL from .env (must match the GitHub App webhook URL)
```

Do **not** expect `pnpm dev` to start the runner. It will fail with `not joined yet` until you create a team and join.

### First login

1. Open `http://localhost:3000` → **Sign in with GitHub** → Authorize.
2. Create a team on `/setup`.
3. Install the App on the org/repos you want (GitHub redirects to `/api/github/setup?installation_id=…`).
4. **Repos** should list the repositories you granted. If it still says “No repos yet”, click **Sync from GitHub** (the panel also syncs automatically when that list is empty).
5. On **Runners**, create a join token, then:

```bash
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000
pnpm dev:runner
```

Then onboard the repo so it can accept jobs: `docs/onboarding.md`. After the recipe PR is merged, label an issue `foundry` to start work.

If Authorize leaves you on GitHub’s “You are being redirected…” page, the Node process could not reach `github.com` (common when the browser uses a system proxy and Node does not). Set `FOUNDRY_HTTP_PROXY` in `.env` and restart `pnpm dev`.

If **Repos** is empty after you installed the App, the Setup URL ran before you had a team (or the install cookie expired). Refresh `/repos` or click **Sync from GitHub** — Foundry lists the App’s installations and attaches any that are not already linked. Keep `pnpm dev:webhooks` running so later “add/remove repos” events stay in sync.

### Harness and model

Each job runs on one harness. **Claude Code** takes Anthropic model IDs; **OpenCode** talks to any
provider you have configured and always names models as `provider/model`. A model name from one
harness does not carry over to the other.

Set the default on **Settings → Team → Default harness / Default model**. A repo card on **Repos**
overrides both for that repo, and an issue label overrides them per job: `harness:opencode` and
`model:deepseek/deepseek-chat`. Leave a model field empty to inherit the next level's default.
Retrying a failed job re-reads these settings (issue override labels still win), so after a harness
error fix the Repo's harness or model and click **Retry** on the job.

| Harness     | Model format                | Examples                                                                                                       |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Claude Code | Anthropic model ID or alias | `claude-sonnet-4-5`, `claude-haiku-4-5`                                                                        |
| OpenCode    | `provider/model`            | `anthropic/claude-sonnet-4-5`, `openai/gpt-5.4`, `deepseek/deepseek-chat`, `openrouter/deepseek/deepseek-chat` |

The OpenCode provider prefix is required. A bare name such as `deepseek-flash` fails at job start
with `Model not found: deepseek-flash/.` — use the provider and model IDs your OpenCode install
knows, e.g. `deepseek/deepseek-chat` rather than `deepseek-flash`. The provider must also be
authenticated on the runner machine, either with `opencode auth login` or the matching environment
variable (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …), which the runner detects.

### Multiple runners on one computer

One joined runner already detects **both** Claude Code and OpenCode (whichever is installed). Extra daemons are for **separate identities**, not for having both harnesses.

| You want                                                                | What to do                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| More jobs on one runner                                                 | Re-join that runner with `--concurrency N`     |
| A second name, a personal runner plus `--shared`, or isolated worktrees | A second daemon: its own `--name` and `--home` |

Re-joining with the **same** `--name` updates that runner. The default name is `<user>-<hostname>`. Two daemons need two names, or the second join replaces the first row on **Runners**.

Each daemon has its own home. The default is `~/.foundry` (`config.json`, the join token, the MCP socket, port leases, worktrees, logs). A second daemon must use another directory. `--home` sets that for the command. `FOUNDRY_HOME` still works if you export it. Do not point two daemons at one home.

`pnpm dev` does not start a runner. `pnpm dev:runner` is only the default home. Create one join token on **Runners** — it is a team token; you can join many daemons with it.

```bash
# Terminal A — default home
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000 --name pipi-claude
pnpm dev:runner

# Terminal B — second home and name
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000 \
  --name pipi-opencode --home ~/.foundry-opencode
bun apps/runner/src/cli.ts runner start --home ~/.foundry-opencode
```

`foundry runner status` and `foundry runner status --home ~/.foundry-opencode` each report their own name. If a home is not joined, the error includes that directory.

On **Runners**, both names show **accepting**. Heartbeats stay independent, and claim uses row locks so the two daemons do not take the same job.

**Services.** `install-service` writes one unit per runner name and puts `FOUNDRY_HOME` in the unit environment, so installing the second does not replace the first.

```bash
bun apps/runner/src/cli.ts runner install-service
bun apps/runner/src/cli.ts runner install-service --home ~/.foundry-opencode
```

|            | macOS                                                             | Linux (user systemd)                                                  |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| Unit       | `dev.foundry.runner.<name>` in `~/Library/LaunchAgents/`          | `foundry-runner-<name>.service`                                       |
| Stop one   | `foundry runner uninstall-service --home ~/.foundry-opencode`     | same flag                                                             |
| Or by hand | `launchctl bootout gui/$(id -u)/dev.foundry.runner.pipi-opencode` | `systemctl --user disable --now foundry-runner-pipi-opencode.service` |

The name in the unit is lowercased, with other characters turned into `-`. `KeepAlive` (macOS) and `Restart=always` (Linux) apply per unit. A system-wide unit (`--system`) still needs sudo; the command prints the file or the bootout lines when you are not root.

An older install used the single label `dev.foundry.runner` / `foundry-runner.service`. After you install the named unit, boot that old one out or two copies of the same runner will run.

The token for `~/.foundry` stays in the macOS Keychain (or `~/.config/foundry` on Linux). Any other home stores its token in `<home>/secrets`, so a second join does not invalidate the first.

### Windows runner

A Windows 10/11 (x64) machine can join as a personal runner. Prerequisites:

- **Git for Windows** (required for `git worktree`; the runner does not reimplement git).
- **Node 22+** and **Bun** to run from source, or the compiled `foundry.exe`
  (`foundry-windows-x64.tar.gz` from the release).
- **Claude Code** and/or **OpenCode** Windows installers, signed in.

```powershell
foundry.exe runner join <token> --server http://<your-foundry>
foundry.exe runner start
```

On Windows the runner runs recipe `install` / `checks` / `dev_server` / `warm` commands through
PowerShell — it prefers `pwsh` (PowerShell 7) when on `PATH`, otherwise `powershell.exe`. POSIX `&&`
and `;` also work in PowerShell 7, so recipes written for macOS/Linux usually run unchanged. Set
`recipe.os: [windows]` for Windows-only commands; a repo with `os: [macos, linux]` is **not** claimed
by a Windows runner, while a repo with no `os:` constraint can be. The per-job MCP bridge listens on
`127.0.0.1:<port>` instead of a Unix socket.

`foundry.exe runner install-service` writes a `.cmd` into the current user's **Startup** folder so the
runner starts at login (there is no launchd/systemd equivalent to manage). Run
`foundry.exe runner start` in a terminal to run in the foreground instead.

## 4. Daily commands

| Command             | What                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`          | Control plane (web + realtime)                                                 |
| `pnpm dev:webhooks` | Forward GitHub webhooks via smee                                               |
| `pnpm dev:runner`   | Runner daemon (after `runner join`)                                            |
| `pnpm db:migrate`   | Apply Drizzle migrations                                                       |
| `pnpm test`         | Vitest unit + API + in-process e2e (DB tests need `FOUNDRY_TEST_DATABASE_URL`) |
| `pnpm test:e2e`     | Playwright against `/signin` (`pnpm exec playwright install chromium` once)    |
| `pnpm test:report`  | Coverage snapshot → `docs/testing-report.md`                                   |
| `pnpm typecheck`    | `tsc` across the workspace                                                     |

### Restart `pnpm dev`

Do this after changing `.env` (including `FOUNDRY_HTTP_PROXY`), after pulling code that touches the web or realtime apps, or if the panel looks stuck.

`pnpm dev` is one process for **web** (`:3000`) and **realtime** (`:3001`). It does **not** start or restart the runner.

1. Click the terminal that is running `pnpm dev`.
2. Press **Ctrl+C** once and wait until it exits. If it hangs, press **Ctrl+C** again.
3. From the repo root:

```bash
cd /Users/pipi/foundry
pnpm dev
```

You should see Next on `http://localhost:3000` and realtime on `ws://localhost:3001`. If `FOUNDRY_HTTP_PROXY` is set, the web process logs `[foundry] HTTP proxy http://127.0.0.1:8118`.

If Ctrl+C does not free the ports:

```bash
lsof -ti tcp:3000,3001 | xargs kill
cd /Users/pipi/foundry
pnpm dev
```

### Restart `pnpm dev:runner`

In the **runner** terminal (a different process from `pnpm dev`): **Ctrl+C**, then from the repo root:

```bash
cd /Users/pipi/foundry
pnpm dev:runner
```

The runner must already be joined (`foundry runner join`). After a proxy or git-related code change, restart the runner or jobs will keep using the old process.

## 5. Production deploy (Docker Compose)

Use this when Docker is available and you have a public hostname. Update the GitHub App URLs to that host first.

```bash
# GitHub App (production)
# Homepage / Callback / Setup:
#   https://<FOUNDRY_DOMAIN>
#   https://<FOUNDRY_DOMAIN>/api/auth/callback/github
#   https://<FOUNDRY_DOMAIN>/api/github/setup
# Webhook URL (no smee):
#   https://<FOUNDRY_DOMAIN>/api/webhooks/github

export FOUNDRY_DOMAIN=foundry.example.com
# POSTGRES_PASSWORD, FOUNDRY_SECRET, and the rest must be in .env
docker compose -f deploy/compose.yaml up -d
```

Compose starts Postgres, migrates, web, realtime, and Caddy (80/443). Caddy proxies `/realtime*` to the realtime service and everything else to the web app.

Bind-mount `github-app.pem` is already in `deploy/compose.yaml`. Set `FOUNDRY_PUBLIC_URL` / `FOUNDRY_REALTIME_URL` to `https://` and `wss://` on that domain (compose overrides these for the web container).

Without Docker, run the same processes as local (`pnpm build` / `pnpm --filter @foundry/web start`, realtime, Postgres) behind any TLS reverse proxy, and point the GitHub App at that origin.

## 6. Layout reminder

See the root `README.md` for package layout. Control-plane source that matters for this setup:

- Auth.js GitHub login: `apps/web/src/auth.ts`
- App Setup URL: `apps/web/src/app/api/github/setup/route.ts`
- Webhooks: `apps/web/src/app/api/webhooks/github/route.ts`
- HTTP proxy (`FOUNDRY_HTTP_PROXY`): `packages/shared/src/proxy.ts`, `apps/web/src/server/retry-fetch.ts`
- Compose stack: `deploy/compose.yaml`
