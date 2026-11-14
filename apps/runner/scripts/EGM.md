# runner/scripts

## Overview

Build-time and smoke-test scripts for the Bun-compiled runner binary. They are
not part of the daemon runtime.

## Interface

- `scripts/build-release.ts` — CLI-driven release builder: compiles `src/cli.ts` for each target, writes `dist/release/foundry-<os>-<arch>.tar.gz`, `SHA256SUMS`, `install.sh`, and the Homebrew formula; optionally packages `.deb`/`.rpm` via `nfpm` ([build-release.ts]).
- `scripts/mcp-smoke.ts` — compile-spike check: starts a local `ToolServer`, launches the compiled binary as `foundry mcp` through the MCP stdio client, lists tools, calls `confidence`, and asserts the call reached the runner socket ([mcp-smoke.ts]).

## Invariants

- The release target list defaults to `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64` and is overridable with `--targets` ([build-release.ts:ALL_TARGETS]).
- `build-release.ts` deletes `dist/release` before writing so stale artifacts cannot ship ([build-release.ts:rmSync]).
- Binary names are `foundry.exe` on Windows and `foundry` elsewhere ([build-release.ts]).
- `mcp-smoke.ts` exits non-zero unless exactly one tool call was received and the server advertises six tools ([mcp-smoke.ts]).
- `--skip-packages` skips `.deb`/`.rpm`; missing `nfpm` downgrades to a log message rather than a failure ([build-release.ts]).

## Side Effects

- Runs `bun build --compile`, `tar`, and optionally `nfpm`; writes files under `dist/release` and reads `packaging/homebrew/foundry.rb.tmpl` ([build-release.ts]).
- `mcp-smoke.ts` creates a Unix socket under `/tmp`, spawns a child process, and cleans up the server.

## Verification

- Run: `pnpm test`
