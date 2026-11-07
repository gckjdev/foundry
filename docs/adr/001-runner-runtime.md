# ADR 001: Runner runtime and packaging

Status: accepted · Date: 2026-11-06

## Context

The runner (`apps/runner`) is installed on team laptops and shared boxes running macOS and Linux.
Installing should not require a Node toolchain, and there should be one file per platform for
Homebrew, the install script and deb/rpm packages. The runner embeds two harnesses:

- Claude Code, through `@anthropic-ai/claude-agent-sdk`. The SDK spawns a Claude Code engine
  process. Since 0.3.x the engine is a platform-native binary of about 320 MB, shipped as an
  optional dependency (`@anthropic-ai/claude-agent-sdk-<os>-<arch>`).
- OpenCode, by spawning `opencode serve` and talking to it over HTTP.

The per-job `foundry` MCP server must run as a stdio subprocess that the harness starts.

## Decision

1. **Bun, compiled.** The runner is TypeScript run by Bun. Releases are built with
   `bun build src/cli.ts --compile --target bun-<os>-<arch>` into a single `foundry` executable
   (about 73 MB on darwin-x64). Development runs from source (`bun src/cli.ts`). Vitest runs the
   tests under Node, so runner code uses only `node:` APIs, with no `bun:` imports. The one
   Bun-only feature is text imports of the playbook `.md` files; Vitest mirrors it with a
   transform in `vitest.config.ts`.
2. **The binary is its own MCP server.** Harnesses start `foundry mcp` (`process.execPath mcp`) with
   the job's socket path and token in env. In development the command is `bun <cli.ts> mcp`.
3. **Claude Code engine: use the installed CLI when compiled.** The native engine is not embedded.
   The adapter passes `pathToClaudeCodeExecutable`, chosen in this order:
   - `FOUNDRY_CLAUDE_PATH`;
   - inside a compiled binary, the `claude` CLI found on PATH;
   - from source, the SDK's own engine.

   Every Claude Code user already installs the CLI to sign in, so this costs nothing. The binary
   stays 4× smaller and the engine updates on its own schedule.
4. **Provider config comes from the user's Claude settings.** Jobs load project settings only
   (`settingSources: ["project"]`), so user hooks and permissions do not leak into unattended runs.
   The `env` block of `~/.claude/settings.json` is still merged into the job environment, so API
   keys, `ANTHROPIC_BASE_URL` and model aliases work as they do interactively.
5. **OpenCode is an external dependency.** The runner spawns the user's `opencode` binary; the
   harness is reported as not installed when it is missing.

## Spike results (darwin-x64, Bun 1.3.14)

| Check                                                                                                                                             | Result                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun build --compile` of the CLI                                                                                                                  | ✓ 388 modules, 73 MB, about 2 s                                                                                                                                                            |
| `foundry --version`, `foundry doctor` from the binary                                                                                             | ✓                                                                                                                                                                                          |
| `foundry mcp` from the binary: MCP client lists 6 tools, `confidence` call reaches the runner socket                                              | ✓ (`bun scripts/mcp-smoke.ts dist/foundry`)                                                                                                                                                |
| Claude Agent SDK `query()` from the binary launches the installed `claude` with user provider env                                                 | ✓ engine started and authenticated. The provider rejected the request for account balance (HTTP 402), so a full model turn was not observed on this machine.                               |
| OpenCode from the binary: `opencode serve` (1.16.2) in a worktree with `OPENCODE_CONFIG_CONTENT`, SDK client creates a session and streams events | ✓ (live test in `packages/harness-opencode`). The configured provider (GLM Coding Plan) had expired, so the turn ended with the provider's error after 3 retries instead of a model reply. |
| Full turn with MCP tool call                                                                                                                      | Run `foundry doctor --live` on a machine with working credentials                                                                                                                          |

## Consequences

- Release matrix: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`,
  cross-compiled from one CI job (`apps/runner/scripts/build-release.ts`).
- `foundry doctor` reports Claude Code as not installed in a compiled runner without the `claude`
  CLI; the fix is `npm i -g @anthropic-ai/claude-code` or the native installer.
- If the SDK and CLI versions drift too far apart, pin the engine with `FOUNDRY_CLAUDE_PATH`.
