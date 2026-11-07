# Handoff brief: Add Windows PowerShell support for Claude Code and OpenCode runners

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T15:52:13.331Z

## Plan

## Plan: Windows PowerShell support for Claude Code + OpenCode runners

Add native Windows (`win32`) support to the runner and harnesses, keeping macOS/Linux behavior unchanged. Windows runs recipe/harness commands through PowerShell and uses a TCP MCP bridge instead of a Unix socket.

### 1. OS schema + adapter
- `packages/os-adapters/src/types.ts`: `OsName = "macos" | "linux" | "windows"`.
- `packages/shared/src/recipe.ts`: `OsSchema = z.enum(["macos", "linux", "windows"])` (claim filtering already uses `allowedOs.includes(r.os)`, so no scheduler change needed).
- `packages/os-adapters/src/exec.ts`: make `which` platform-aware (`where.exe` on win32); add `killTree(pid, signal, platform?)` (POSIX process group / `taskkill /T`), `taskkillArgs`, `platformExecutable(name)` (`.cmd`/`.exe` via `where.exe`), `windowsExecutablePath(name)`.
- New `packages/os-adapters/src/windows.ts`: `WindowsAdapter` — `info` (PowerShell `Win32_OperatingSystem` caption), `diskFreeMb` (`fs.statfs`), `onAcPower` (`Win32_Battery`), `idleSeconds` → null (documented best-effort), `inhibitSleep` (PowerShell `SetThreadExecutionState`), `secrets` (FileSecretStore under `~/.foundry`), `service` (Startup-folder `.cmd`), `createUserCommands` → `[]`, `wrapWithLimits` no-op.
- `packages/os-adapters/src/index.ts`: export windows; `currentOsAdapter(platform = process.platform)` returns `WindowsAdapter` for win32, throws only for unknown platforms.

### 2. PowerShell recipe + harness commands
- `apps/runner/src/checks.ts`: add `shellArgv(command, platform, windowsShell)` and `detectWindowsShell()` (prefer `pwsh`, else `powershell.exe`); use it in `runCommand`/`startCommand`; replace `process.kill(-pid)` with `killTree`.

### 3. MCP over TCP on Windows
- `packages/mcp-foundry/src/bridge.ts`: add `MCP_URL_ENV = "FOUNDRY_MCP_URL"`, `mcpUsesTcp(platform)`, `httpBridge(baseUrl, jobId, token)`; `bridgeFromEnv` accepts URL or socket.
- `apps/runner/src/tool-server.ts`: on win32 bind `127.0.0.1:0`, expose `url`; keep Unix socket on POSIX.
- `apps/runner/src/job-runner.ts`: `mcpServers()` sets `FOUNDRY_MCP_URL` when `tools.url` is set, else `FOUNDRY_MCP_SOCKET`.
- `apps/runner/src/smoke.ts`: platform-aware MCP env + `tmpdir()` socket.

### 4. Harness binary resolution
- `packages/harness-claude-code/src/adapter.ts`: `claudeExecutable()` uses `windowsExecutablePath("claude")` on win32 (no `sh -c`); `detect()` uses `platformExecutable("claude")`.
- `packages/harness-opencode/src/adapter.ts`: `opencodeBinary()` uses `platformExecutable("opencode")`; `kill(proc)` uses `killTree`.
- Add `@foundry/os-adapters` dep to both harness `package.json`s (and `pnpm install`).

### 5. Packaging + docs
- `apps/runner/scripts/build-release.ts`: add `windows-x64` target with `foundry.exe` outfile.
- `docs/local-setup.md`: Windows join section (Git for Windows, Node/compiled exe, Claude/OpenCode installers, PowerShell + recipe.os note).
- `docs/adr/001-runner-runtime.md`: add `bun-windows-x64` to release matrix note.

### Tests (run on macOS/Linux CI)
- `packages/os-adapters/src/os.test.ts` (or new `windows.test.ts`): WindowsAdapter parsing (AC power), startup script, secrets kind, `wrapWithLimits` no-op, `createUserCommands` empty, `currentOsAdapter("win32")`, unknown-platform throw, `platformExecutable`/`windowsExecutablePath` on posix, `killTree`/`taskkillArgs`, `which` win32 arg.
- `packages/shared/src/shared.test.ts`: recipe `os: [windows]` parses.
- `apps/runner/src/checks.test.ts`: `shellArgv` POSIX vs Windows argv.
- `packages/mcp-foundry/src/mcp.test.ts`: `mcpUsesTcp`, `bridgeFromEnv` URL precedence, `httpBridge` round-trip over a real HTTP server.

## Findings

- triage: Ticket is detailed and unambiguous; moving to investigate the relevant code.
- investigating: Investigated all POSIX-only paths (adapter index, checks sh -c, ToolServer Unix socket, bridge, harness binary lookup, release matrix). Plan covers schema, adapter, PowerShell commands, TCP MCP, harness resolution, packaging and tests.
- implementing: Ran run_checks (lint, typecheck, full test suite) — all pass. No UI changed, so no screenshot is needed.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

_none_

## Open uncertainties

- Windows runtime paths (PowerShell Get-CimInstance/SetThreadExecutionState scripts, fs.statfs disk free, taskkill, .cmd Startup launcher, where.exe lookups) were not executed on a real Windows machine; v1 CI is POSIX-only per the ticket, so these are verified by construction and mocks, not by running Windows.

```json
{
  "version": 1,
  "jobId": "7e82cb00-0e53-4a5b-98d3-0f15f21334e8",
  "title": "Add Windows PowerShell support for Claude Code and OpenCode runners",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "d931bfd0-fd3a-45de-8e99-43a27bd6770a",
  "plan": "## Plan: Windows PowerShell support for Claude Code + OpenCode runners\n\nAdd native Windows (`win32`) support to the runner and harnesses, keeping macOS/Linux behavior unchanged. Windows runs recipe/harness commands through PowerShell and uses a TCP MCP bridge instead of a Unix socket.\n\n### 1. OS schema + adapter\n- `packages/os-adapters/src/types.ts`: `OsName = \"macos\" | \"linux\" | \"windows\"`.\n- `packages/shared/src/recipe.ts`: `OsSchema = z.enum([\"macos\", \"linux\", \"windows\"])` (claim filtering already uses `allowedOs.includes(r.os)`, so no scheduler change needed).\n- `packages/os-adapters/src/exec.ts`: make `which` platform-aware (`where.exe` on win32); add `killTree(pid, signal, platform?)` (POSIX process group / `taskkill /T`), `taskkillArgs`, `platformExecutable(name)` (`.cmd`/`.exe` via `where.exe`), `windowsExecutablePath(name)`.\n- New `packages/os-adapters/src/windows.ts`: `WindowsAdapter` — `info` (PowerShell `Win32_OperatingSystem` caption), `diskFreeMb` (`fs.statfs`), `onAcPower` (`Win32_Battery`), `idleSeconds` → null (documented best-effort), `inhibitSleep` (PowerShell `SetThreadExecutionState`), `secrets` (FileSecretStore under `~/.foundry`), `service` (Startup-folder `.cmd`), `createUserCommands` → `[]`, `wrapWithLimits` no-op.\n- `packages/os-adapters/src/index.ts`: export windows; `currentOsAdapter(platform = process.platform)` returns `WindowsAdapter` for win32, throws only for unknown platforms.\n\n### 2. PowerShell recipe + harness commands\n- `apps/runner/src/checks.ts`: add `shellArgv(command, platform, windowsShell)` and `detectWindowsShell()` (prefer `pwsh`, else `powershell.exe`); use it in `runCommand`/`startCommand`; replace `process.kill(-pid)` with `killTree`.\n\n### 3. MCP over TCP on Windows\n- `packages/mcp-foundry/src/bridge.ts`: add `MCP_URL_ENV = \"FOUNDRY_MCP_URL\"`, `mcpUsesTcp(platform)`, `httpBridge(baseUrl, jobId, token)`; `bridgeFromEnv` accepts URL or socket.\n- `apps/runner/src/tool-server.ts`: on win32 bind `127.0.0.1:0`, expose `url`; keep Unix socket on POSIX.\n- `apps/runner/src/job-runner.ts`: `mcpServers()` sets `FOUNDRY_MCP_URL` when `tools.url` is set, else `FOUNDRY_MCP_SOCKET`.\n- `apps/runner/src/smoke.ts`: platform-aware MCP env + `tmpdir()` socket.\n\n### 4. Harness binary resolution\n- `packages/harness-claude-code/src/adapter.ts`: `claudeExecutable()` uses `windowsExecutablePath(\"claude\")` on win32 (no `sh -c`); `detect()` uses `platformExecutable(\"claude\")`.\n- `packages/harness-opencode/src/adapter.ts`: `opencodeBinary()` uses `platformExecutable(\"opencode\")`; `kill(proc)` uses `killTree`.\n- Add `@foundry/os-adapters` dep to both harness `package.json`s (and `pnpm install`).\n\n### 5. Packaging + docs\n- `apps/runner/scripts/build-release.ts`: add `windows-x64` target with `foundry.exe` outfile.\n- `docs/local-setup.md`: Windows join section (Git for Windows, Node/compiled exe, Claude/OpenCode installers, PowerShell + recipe.os note).\n- `docs/adr/001-runner-runtime.md`: add `bun-windows-x64` to release matrix note.\n\n### Tests (run on macOS/Linux CI)\n- `packages/os-adapters/src/os.test.ts` (or new `windows.test.ts`): WindowsAdapter parsing (AC power), startup script, secrets kind, `wrapWithLimits` no-op, `createUserCommands` empty, `currentOsAdapter(\"win32\")`, unknown-platform throw, `platformExecutable`/`windowsExecutablePath` on posix, `killTree`/`taskkillArgs`, `which` win32 arg.\n- `packages/shared/src/shared.test.ts`: recipe `os: [windows]` parses.\n- `apps/runner/src/checks.test.ts`: `shellArgv` POSIX vs Windows argv.\n- `packages/mcp-foundry/src/mcp.test.ts`: `mcpUsesTcp`, `bridgeFromEnv` URL precedence, `httpBridge` round-trip over a real HTTP server.",
  "findings": [
    "triage: Ticket is detailed and unambiguous; moving to investigate the relevant code.",
    "investigating: Investigated all POSIX-only paths (adapter index, checks sh -c, ToolServer Unix socket, bridge, harness binary lookup, release matrix). Plan covers schema, adapter, PowerShell commands, TCP MCP, harness resolution, packaging and tests.",
    "implementing: Ran run_checks (lint, typecheck, full test suite) — all pass. No UI changed, so no screenshot is needed."
  ],
  "checks": [
    {
      "name": "lint",
      "status": "passed"
    },
    {
      "name": "typecheck",
      "status": "passed"
    },
    {
      "name": "test",
      "status": "passed"
    }
  ],
  "qa": [],
  "uncertainties": [
    "Windows runtime paths (PowerShell Get-CimInstance/SetThreadExecutionState scripts, fs.statfs disk free, taskkill, .cmd Startup launcher, where.exe lookups) were not executed on a real Windows machine; v1 CI is POSIX-only per the ticket, so these are verified by construction and mocks, not by running Windows."
  ],
  "updatedAt": "2026-11-07T15:52:13.331Z"
}
```
