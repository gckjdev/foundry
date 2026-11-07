import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export const FOUNDRY_TOOL_NAMES = ["stage", "plan", "ask", "evidence", "run_checks", "confidence"] as const;
export type FoundryToolName = (typeof FOUNDRY_TOOL_NAMES)[number];

export interface ToolReply {
  text: string;
  isError?: boolean;
}

/** Where tool calls go: the runner, over a local socket (or directly in tests). */
export interface ToolBridge {
  call(tool: FoundryToolName, args: Record<string, unknown>): Promise<ToolReply>;
}

/**
 * The per-job `foundry` MCP server (spec 5.8, reporter part 1). The agent reports progress
 * explicitly through these tools; the same server works for every harness.
 */
export function createFoundryMcpServer(bridge: ToolBridge, version = "0.1.0"): McpServer {
  const server = new McpServer({ name: "foundry", version });
  const forward = (tool: FoundryToolName) => async (args: Record<string, unknown>) => {
    try {
      const reply = await bridge.call(tool, args);
      return { content: [{ type: "text" as const, text: reply.text }], isError: reply.isError ?? false };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Foundry runner unreachable: ${String(err)}` }],
        isError: true,
      };
    }
  };

  server.registerTool(
    "stage",
    {
      description:
        "Declare that you finished the current playbook stage and are moving to the next one. Stages run in order: triage → investigating → implementing → verifying → done. Call with name='done' after verification passes.",
      inputSchema: {
        name: z
          .enum(["investigating", "implementing", "verifying", "done"])
          .describe("The stage you are starting"),
        summary: z.string().describe("Two or three sentences on what the finished stage established"),
      },
    },
    forward("stage"),
  );
  server.registerTool(
    "plan",
    {
      description:
        "Record your implementation plan (markdown, numbered steps, files you expect to touch). Call once at the end of investigating.",
      inputSchema: { plan: z.string().min(1) },
    },
    forward("plan"),
  );
  server.registerTool(
    "ask",
    {
      description:
        "Ask the ticket author one decision instead of guessing, when the answer changes what you build. Offer 2–4 concrete options. After calling this, stop working: the job pauses and you are resumed with the answer.",
      inputSchema: {
        question: z.string().min(1),
        options: z.array(z.string()).max(6).default([]),
      },
    },
    forward("ask"),
  );
  server.registerTool(
    "evidence",
    {
      description:
        "Attach verification evidence: a screenshot of changed UI (PNG path inside the worktree) or a note. Recipe checks are recorded by run_checks, not here.",
      inputSchema: {
        kind: z.enum(["screenshot", "note"]),
        name: z.string().min(1),
        status: z.enum(["passed", "failed", "skipped"]).default("passed"),
        path: z.string().optional().describe("Screenshot file path, relative to the worktree"),
        detail: z.string().optional(),
      },
    },
    forward("evidence"),
  );
  server.registerTool(
    "run_checks",
    {
      description:
        "Run the repo's recipe checks (tests, lint, typecheck…) in this worktree and return the results. The runner records them as evidence; only these results count for the merge gate.",
      inputSchema: { names: z.array(z.string()).optional().describe("Subset of check names; default all") },
    },
    forward("run_checks"),
  );
  server.registerTool(
    "confidence",
    {
      description:
        "Report how confident you are that the change is correct and complete. Be honest: anything below high, or any open uncertainty, hands the PR to a human.",
      inputSchema: {
        level: z.enum(["high", "medium", "low"]),
        reasons: z.array(z.string()).default([]),
        uncertainties: z.array(z.string()).default([]),
      },
    },
    forward("confidence"),
  );
  return server;
}

/** Entry point for `foundry mcp`: serve over stdio, forwarding to the runner socket in the env. */
export async function runStdioServer(bridge: ToolBridge, version?: string): Promise<void> {
  const server = createFoundryMcpServer(bridge, version);
  await server.connect(new StdioServerTransport());
}
