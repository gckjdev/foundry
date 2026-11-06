import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createFoundryMcpServer, socketBridge, type ToolCallRequest } from "./index";

describe("foundry MCP server", () => {
  it("lists the reporter tools and forwards calls through the bridge", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const server = createFoundryMcpServer({
      async call(tool, args) {
        calls.push([tool, args]);
        return { text: `ok ${tool}` };
      },
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["ask", "confidence", "evidence", "plan", "run_checks", "stage"]);
    const res = await client.callTool({ name: "ask", arguments: { question: "CSV or XLSX?", options: ["CSV", "XLSX"] } });
    expect(res.content).toEqual([{ type: "text", text: "ok ask" }]);
    expect(calls).toEqual([["ask", { question: "CSV or XLSX?", options: ["CSV", "XLSX"] }]]);
    await client.close();
  });

  it("relays tool calls over a Unix socket", async () => {
    const socket = join(mkdtempSync(join(tmpdir(), "fmcp-")), "r.sock");
    const got: ToolCallRequest[] = [];
    const http = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        got.push(JSON.parse(body));
        res.end(JSON.stringify({ text: "recorded" }));
      });
    });
    await new Promise<void>((r) => http.listen(socket, r));
    const reply = await socketBridge(socket, "job-1", "tok").call("stage", { name: "implementing", summary: "s" });
    expect(reply).toEqual({ text: "recorded" });
    expect(got[0]).toEqual({ jobId: "job-1", token: "tok", tool: "stage", args: { name: "implementing", summary: "s" } });
    http.close();
  });
});
