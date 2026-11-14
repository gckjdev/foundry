# @foundry/mcp-foundry — Source

## Overview

Per-job MCP server exposing the Foundry tools (`stage`, `plan`, `ask`, `evidence`, `run_checks`, `confidence`, `review`) to a harness over stdio, TCP or a Unix socket. Tool calls are forwarded through a `ToolBridge` to the runner, which applies them to the job.

## Interface

- `[index.ts]` — `FOUNDRY_TOOL_NAMES`, `createFoundryMcpServer`, `runStdioServer`, and re-exports of schemas/bridges.
- `[server.ts]` — tool registration, Zod schemas `ReviewCategorySchema`, `ReviewFindingSchema`, `MergeRiskSchema`, `ReviewReportSchema`, request/response shapes per tool.
- `[bridge.ts]` — `ToolBridge` interface, `socketBridge`, `httpBridge`, `bridgeFromEnv`, env constants (`FOUNDRY_MCP_*`), `mcpUsesTcp`.

## Invariants

- Exactly the seven tools are advertised; a new tool must be added to `FOUNDRY_TOOL_NAMES` and the server `[index.ts:FOUNDRY_TOOL_NAMES]`.
- A bridge failure is returned as a tool result with `isError: true`, never thrown out of the handler `[server.ts]`.
- Startup requires a `jobId` plus a token, and exactly one of a url or a socket `[bridge.ts:bridgeFromEnv]`.
- Tool calls time out after 30 minutes `[server.ts]`.
- On Windows the bridge uses TCP rather than a Unix socket `[bridge.ts:mcpUsesTcp]`.

## Side Effects

- `runStdioServer` binds stdin/stdout for the MCP transport.
- The bridge opens a socket/HTTP connection to the runner and performs one request per tool call.
- No I/O at import; configuration is read when the server starts.

## Verification

- Run: `pnpm test`
