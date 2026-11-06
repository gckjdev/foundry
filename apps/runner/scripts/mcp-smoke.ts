/**
 * Compile-spike check (docs/adr/001-runner-runtime.md): start the compiled `foundry mcp` as a
 * real MCP client would, list its tools, call one, and confirm the call reached the runner socket.
 *
 *   bun build src/cli.ts --compile --outfile dist/foundry && bun scripts/mcp-smoke.ts dist/foundry
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolServer } from "../src/tool-server";

const binary = process.argv[2] ?? "dist/foundry";
const tools = new ToolServer(`/tmp/fdr-mcp-smoke-${process.pid}.sock`);
await tools.start();
const received: string[] = [];
const token = tools.register("job-1", async (tool, args) => {
  received.push(`${tool} ${JSON.stringify(args)}`);
  return { text: "recorded" };
});

const transport = new StdioClientTransport({
  command: binary,
  args: ["mcp"],
  env: { ...(process.env as Record<string, string>), FOUNDRY_MCP_SOCKET: tools.socketPath, FOUNDRY_JOB_ID: "job-1", FOUNDRY_MCP_TOKEN: token },
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
const list = await client.listTools();
const result = await client.callTool({ name: "confidence", arguments: { level: "high", reasons: ["smoke"] } });
await client.close();
await tools.close();

console.log(`tools: ${list.tools.map((t) => t.name).join(", ")}`);
console.log(`reply: ${JSON.stringify(result.content)}`);
console.log(`runner received: ${received.join("; ")}`);
if (received.length !== 1 || list.tools.length !== 6) process.exit(1);
