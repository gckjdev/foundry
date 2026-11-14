# @foundry/mcp-foundry

## Overview

Per-job MCP server exposing the Foundry tools to a harness. Package boundary: name `@foundry/mcp-foundry`, ESM, exports TypeScript source `[package.json:exports]`. Single entry point `.` → `./src/index.ts` `[package.json:exports]`. Depends on `@modelcontextprotocol/sdk` and `zod` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): tool schemas and registration, stdio server, and the socket/HTTP tool bridge.

## Interface

- `.` exports `FOUNDRY_TOOL_NAMES`, `createFoundryMcpServer`, `runStdioServer`, the review schemas and the bridges `[src/index.ts]`.

## Invariants

- Exactly seven tools are advertised: `stage`, `plan`, `ask`, `evidence`, `run_checks`, `confidence`, `review` `[src/index.ts:FOUNDRY_TOOL_NAMES]`.
- A bridge failure is returned as `isError`, never thrown `[src/server.ts]`.

## Side Effects

- Binds stdio for the MCP transport and opens a socket/HTTP connection to the runner per tool call.

## Verification

- Run: `pnpm test`
