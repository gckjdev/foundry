# Configuration, install, and deploy

This is the runbook for the Foundry control plane on this machine, plus how to deploy it. Secrets live only in gitignored `.env` and `github-app.pem` — never copy those values into git.

## What is running locally

| Piece              | How                                                                      |
| ------------------ | ------------------------------------------------------------------------ |
| Web panel          | `http://localhost:3000` (`pnpm dev`)                                     |
| Realtime WebSocket | `ws://localhost:3001`                                                    |
| Postgres           | existing local instance on **54329** (Docker is not installed here)      |
| GitHub App         | [gckjdevfoundryapp](https://github.com/settings/apps/gckjdevfoundryapp)  |
| Webhook tunnel     | `pnpm dev:webhooks` → smee.io → `/api/webhooks/github`                   |
| Runner             | **not** started by `pnpm dev`; join a team first, then `pnpm dev:runner` |

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

```bash
pnpm install
pnpm db:migrate          # uses DATABASE_URL
pnpm dev                 # web :3000 + realtime :3001 only
```

In a second terminal, while developing against GitHub webhooks:

```bash
pnpm dev:webhooks        # needs SMEE_URL in the environment
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

## 4. Daily commands

| Command             | What                                               |
| ------------------- | -------------------------------------------------- |
| `pnpm dev`          | Control plane (web + realtime)                     |
| `pnpm dev:webhooks` | Forward GitHub webhooks via smee                   |
| `pnpm dev:runner`   | Runner daemon (after `runner join`)                |
| `pnpm db:migrate`   | Apply Drizzle migrations                           |
| `pnpm test`         | Vitest (DB tests need `FOUNDRY_TEST_DATABASE_URL`) |
| `pnpm typecheck`    | `tsc` across the workspace                         |

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
