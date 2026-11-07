# Configuration, install, and deploy

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

### Multiple runners on one computer

One joined runner can already detect **both** Claude Code and OpenCode (whichever is installed) and can run several jobs at once with `--concurrency`. You only need extra daemons if you want **separate names** (for `runner:<name>` pins), a personal runner and a `--shared` runner on the same box, or isolated worktrees.

**More jobs, same runner** (usual case):

```bash
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000 --concurrency 2
pnpm dev:runner
```

Re-joining with the **same** `--name` updates that runner (including concurrency). The default name is `<user>-<hostname>`.

**Two daemons on one login:** each needs its own `--name` and `FOUNDRY_HOME`. They cannot share `~/.foundry` (that directory holds `config.json`, the MCP socket, port leases, and worktrees). Create one join token on **Runners** — it is a team token; you can join many machines with it.

```bash
# Terminal A — default home, default name
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000 --name pipi-claude
pnpm dev:runner

# Terminal B — second home and name (keep this FOUNDRY_HOME on every command for this runner)
export FOUNDRY_HOME="$HOME/.foundry-opencode"
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000 --name pipi-opencode
bun apps/runner/src/cli.ts runner start
```

`pnpm dev:runner` always uses `~/.foundry`. Extra runners must be started with `FOUNDRY_HOME=… bun apps/runner/src/cli.ts runner start` (same for `doctor`, `status`, `open`).

Do **not** run `foundry runner install-service` twice on one user — launchd/systemd only have one unit name. Leave the second daemon in the foreground, or in its own terminal.

On **Runners**, you should see both names **accepting**. Stop each with Ctrl+C in its terminal. After a restart, export the same `FOUNDRY_HOME` before `runner start` or the second process will look like “not joined yet”.

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
