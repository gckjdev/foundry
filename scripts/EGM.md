# Scripts

## Overview

Repository-level Node.js helper scripts (ESM, `.mjs`) that sit outside the pnpm workspace packages. They are thin CLI wrappers for development and reporting tasks: `coverage-report.mjs` turns Vitest's JSON coverage summary into the committed `docs/testing-report.md`, and `dev-webhooks.mjs` loads the root `.env` and forwards GitHub webhooks from smee.io to the local control plane. Both are invoked from the root `package.json` scripts (`test:report` and `dev:webhooks` respectively) and must run with the repository root as the working directory.

## Interface

- `./coverage-report.mjs` — CLI entry point (shebang `#!/usr/bin/env node`). Reads `coverage/coverage-summary.json` via `readFileSync`, aggregates per-bucket coverage, and writes `docs/testing-report.md` via `writeFileSync`. Internal helpers: `pct(metric)`, `bucket(file)`, `rate(covered, all)`, `markdownTable(headers, bodyRows)`. Invoked as `node scripts/coverage-report.mjs` by the root `test:report` script (`package.json`).
- `./dev-webhooks.mjs` — CLI entry point. Resolves the repo root from `import.meta.url` (`fileURLToPath`, `dirname`, `join`), loads `.env`, validates `SMEE_URL`, then `spawn`s the external `smee` CLI. Invoked as `node scripts/dev-webhooks.mjs` by the root `dev:webhooks` script (`package.json`).

## Invariants

- `coverage-report.mjs` requires `coverage/coverage-summary.json` at `join(process.cwd(), "coverage/coverage-summary.json")`; on any read/parse error it prints `"Run \`pnpm test:coverage\` first (writes coverage/coverage-summary.json)."` and exits with code `1` (`[coverage-report.mjs:summaryPath, catch]`).
- `coverage-report.mjs` resolves both input and output paths against `process.cwd()`, so it must be executed from the repository root (`[coverage-report.mjs:summaryPath]`, `[coverage-report.mjs:writeFileSync]`).
- `coverage-report.mjs` skips the `"total"` key when grouping and uses that key only for the Overall table; every other top-level entry is treated as a file with `statements` / `branches` / `functions` / `lines` metrics (`[coverage-report.mjs:groups loop]`).
- `coverage-report.mjs` buckets files by the regex `^(packages/[^/]+|apps/[^/]+)` after stripping the cwd prefix; anything else is reduced to its first two path segments (`[coverage-report.mjs:bucket]`).
- `coverage-report.mjs` renders `"n/a"` instead of a percentage when a denominator is `0` (`[coverage-report.mjs:rate]`) or when a metric percentage is not a number (`[coverage-report.mjs:pct]`).
- The database status line is derived solely from whether `FOUNDRY_TEST_DATABASE_URL` is set: `"included"` vs `"skipped (FOUNDRY_TEST_DATABASE_URL unset)"` (`[coverage-report.mjs:db]`).
- `dev-webhooks.mjs` never overrides an already-set environment variable: lines from `.env` are skipped when `process.env[key]` is truthy (`[dev-webhooks.mjs:env loop]`).
- `dev-webhooks.mjs` ignores blank lines, lines beginning with `#`, and lines with no `=` at index > 0; matching surrounding single or double quotes are stripped from values (`[dev-webhooks.mjs:env loop]`).
- `dev-webhooks.mjs` exits with code `1` and an error message when `SMEE_URL` is unset or empty (`[dev-webhooks.mjs:SMEE_URL check]`).
- Forwarding target is hard-coded to `http://localhost:3000/api/webhooks/github` (`[dev-webhooks.mjs:spawn]`).
- The spawned `smee` child uses `stdio: "inherit"` and `cwd` set to the repo root (`[dev-webhooks.mjs:spawn]`).
- The parent exits with the child's exit code, defaulting to `1` when the code is `null`/`undefined` (`[dev-webhooks.mjs:child.on("exit")]`).

## Side Effects

- `coverage-report.mjs` reads `coverage/coverage-summary.json` from disk (`[coverage-report.mjs:readFileSync]`).
- `coverage-report.mjs` overwrites `docs/testing-report.md` in the cwd (`[coverage-report.mjs:writeFileSync]`).
- `coverage-report.mjs` writes `"Wrote docs/testing-report.md"` to stdout and error text to stderr; may call `process.exit(1)` (`[coverage-report.mjs:console.log, console.error]`).
- `dev-webhooks.mjs` reads `<repo root>/.env` when it exists (`[dev-webhooks.mjs:existsSync, readFileSync]`).
- `dev-webhooks.mjs` mutates `process.env` with values from `.env` (`[dev-webhooks.mjs:process.env[key] = val]`).
- `dev-webhooks.mjs` spawns an external `smee` process (resolved via `PATH`) that performs outbound network forwarding, and inherits the parent's stdio (`[dev-webhooks.mjs:spawn]`).
- `dev-webhooks.mjs` terminates the parent process via `process.exit` on missing configuration or when the child exits (`[dev-webhooks.mjs:process.exit]`).

## Verification

- Run: `pnpm test` (from the repository root)
