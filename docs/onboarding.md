# Onboarding a repo

Onboarding is the first job Foundry runs on a repository. An agent writes `.foundry/recipe.yaml`, `.foundry/policy.yaml`, and a GitHub issue form, proves the recipe commands on your runner, and opens a pull request. You review and merge that PR. After that, labeling an issue `foundry` starts real work.

The control plane (`pnpm dev`) does **not** run jobs. A joined runner does.

## Before you start

1. Panel at `http://localhost:3000`, signed in with GitHub, with a team created.
2. The GitHub App is installed on the repo, and **Repos** lists it. If the list is empty, click **Sync from GitHub**. See `docs/local-setup.md`.
3. At least one runner is joined and running (next section). Without it, onboarding stays **queued**.
4. The default harness is Claude Code. Install it and sign in on the runner machine (`claude` works in a terminal). OpenCode is the other option if you set it on the repo.

## 1. Join a runner

Open **http://localhost:3000/runners**.

1. Under **Add a runner**, click **Create join token**. Copy it (valid 7 days; shown once).
2. On the machine that will run jobs:

```bash
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000
pnpm dev:runner
```

Add `--shared` only for a always-on box (Mac mini, Linux). A laptop is personal; jobs pause when it sleeps.

The runner should appear on **Runners** as **accepting**. `foundry doctor` (or `bun apps/runner/src/cli.ts doctor`) checks git, disk, and harness sign-in.

## 2. Start onboarding

Open **http://localhost:3000/repos**.

1. Find the repo (for example `gckjdev/foundry`).
2. Click **Onboard repo**.
3. The pill becomes **onboarding…**. Foundry creates a job titled `Set up Foundry for <owner/name>`.

You can start onboarding before the runner is online; the job waits in **queued**.

## 3. Watch it

| Where | What you see |
|---|---|
| **Board** | Job in Queued, then Working |
| **Job page** | Status, runner name, live log, waiting reason |
| **Repos** | Pill: onboarding… → recipe PR open → accepting jobs |

Open the job from the board (or `/jobs/<id>`). While it is queued you may see **Waiting: no runners joined** or **no runner online**.

Healthy progress: queued → triage → investigating → implementing → verifying → a pull request.

If the agent is unsure, the job moves to **Needs input**. Answer on the job page (or in GitHub when a question comment appears).

## 4. How you know it finished

Onboarding is **not** done when the pill says onboarding…. That only means a job exists.

| Repos pill | Job | What to do |
|---|---|---|
| onboarding… | queued / working | Wait, or join/start a runner |
| onboarding failed | failed | Read the job’s failure reason; click **Retry onboarding** |
| recipe PR open | has a **Pull request** link | Review and merge the PR |
| accepting jobs | merged (after you merge) | Label issues `foundry` |

The agent must not change application code. The PR should only add:

- `.foundry/recipe.yaml` — install, checks, optional dev server
- `.foundry/policy.yaml` — merge off, cost/loop caps, risk rules
- `.github/ISSUE_TEMPLATE/foundry.yml` — issue form with the `foundry` label

Merge on GitHub. With `pnpm dev:webhooks` running, Foundry notices `.foundry/` on the default branch and the pill becomes **accepting jobs**. If webhooks are not forwarded, click **Sync from GitHub** or open **Repos** again after merge; a refresh of recipe files from `main` is what flips `acceptsJobs`.

## 5. After onboarding

Create or open a GitHub issue, add the label **foundry**. Foundry queues a ticket job on a runner that has the repo ready.

Do not label issues until the pill is **accepting jobs**. Ticket jobs wait with **repo not onboarded** until a valid recipe is on the default branch.

## Troubleshooting

**Stuck on onboarding… / queued.** No runner has joined, or `pnpm dev:runner` is not running. Create a token on **Runners**, join, start the daemon. Confirm the runner is **accepting**.

**Harness missing / not signed in.** On **Runners**, the harness line is red. Sign in to Claude Code (or OpenCode) on that machine, keep the runner process running.

**Job failed.** Open the job, read the failure text and log. **Retry onboarding** on **Repos** starts a new onboarding job.

**PR never appears.** The runner never reached verifying, or opening the PR failed (GitHub App permissions: contents + pull requests). Check the job log.

**Merged but still not accepting jobs.** `.foundry/recipe.yaml` is missing or invalid on `main`, or Foundry did not see the push. Run `pnpm dev:webhooks` with `SMEE_URL` matching the GitHub App webhook URL, then push an empty commit or click **Sync from GitHub**.
