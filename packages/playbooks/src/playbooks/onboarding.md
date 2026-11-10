# Foundry onboarding playbook

You are setting up a repository so that Foundry can work tickets in it. You write three files, prove
every command in them works on this machine, and the runner opens a pull request for the team to review.

Report progress through the `foundry` MCP tools.

## Files to write

1. `.foundry/recipe.yaml`, which tells the runner how to install, check and run the project:

   ```yaml
   install: pnpm install --frozen-lockfile     # one shell command
   checks:                                     # what proves a change works; all must pass
     - name: test
       run: pnpm test
     - name: lint
       run: pnpm lint
     - name: typecheck
       run: pnpm typecheck
   dev_server:                                 # optional, for UI screenshots
     run: pnpm dev --port $FOUNDRY_PORT
     ready_path: /
   services:                                   # optional: per-job database on the runner's Postgres
     postgres: { database: app }
   env_file: .env.example                      # optional: copied to .env for each job
   system_deps: [node>=20, pnpm]               # what a runner needs installed
   warm: [pnpm exec playwright install chromium]
   os: [macos, linux]                          # optional constraint
   ui_paths: ["src/components/**", "app/**/page.tsx"]
   ```

2. `.foundry/policy.yaml`, a conservative start the team can loosen later:

   ```yaml
   merge: off
   require_ci_green: true
   max_verify_loops: 3
   max_review_loops: 2
   max_cost_per_job_usd: 10
   max_diff_lines_for_automerge: 400
   risk_rules:
     - name: migrations
       paths: ["**/migrations/**"]
       reviewers: []
   ```

   Add risk rules for anything you find that is dangerous to change unattended: database migrations,
   auth, billing or payments, infrastructure and CI files, security-sensitive code.

3. `.github/ISSUE_TEMPLATE/foundry.yml`, an issue form with these fields: Goal (required), Acceptance
   criteria (required), Constraints, Out of scope. Add the label `foundry` by default.

## Stages

1. **Triage.** Look at the repo: languages, package manager, test runner, linters, CI workflows, README.
   Call `stage(investigating)`.
2. **Investigating.** Work out the exact install and check commands. CI workflows are the best source.
   Call `stage(implementing)`.
3. **Implementing.** Write the three files. Call `stage(reviewing)`.
4. **Reviewing.** Call `stage(reviewing)` and end your turn. An independent reviewer checks the files
   against this playbook and the repository. If it requests changes, fix them and call `stage(reviewing)`
   again; when it approves, you will be resumed to continue. If a later verification failure sends you
   back to Implementing, call `stage(reviewing)` again before re-verifying.
5. **Verifying.** Run the install command and every check yourself, and the dev server if you defined
   one. Fix the recipe until everything passes on this machine. Only include checks that pass on a
   clean checkout. Then call `confidence` and `stage(done)` with a summary of what you found, what the
   checks cover, and anything the team should know (flaky tests, missing services).

Do not change application code. If a check cannot pass without code changes, leave it out of the recipe and
explain why in the summary.
