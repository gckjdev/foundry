import { request } from "node:http";
import type { FoundryToolName, ToolBridge, ToolReply } from "./server";

export const MCP_SOCKET_ENV = "FOUNDRY_MCP_SOCKET";
export const MCP_JOB_ENV = "FOUNDRY_JOB_ID";
export const MCP_TOKEN_ENV = "FOUNDRY_MCP_TOKEN";

export interface ToolCallRequest {
  jobId: string;
  token: string;
  tool: FoundryToolName;
  args: Record<string, unknown>;
}

/** Client side: POST each tool call to the runner's Unix socket. Works under Node and Bun. */
export function socketBridge(socketPath: string, jobId: string, token: string): ToolBridge {
  return {
    call(tool, args) {
      const body = JSON.stringify({ jobId, token, tool, args } satisfies ToolCallRequest);
      return new Promise<ToolReply>((resolve, reject) => {
        const req = request(
          {
            socketPath,
            path: "/tool",
            method: "POST",
            headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
            timeout: 30 * 60_000, // run_checks can take a while
          },
          (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (c) => {
              data += c;
            });
            res.on("end", () => {
              try {
                resolve(JSON.parse(data) as ToolReply);
              } catch {
                resolve({ text: data || `runner returned ${res.statusCode}`, isError: true });
              }
            });
          },
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("runner timed out")));
        req.end(body);
      });
    },
  };
}

export function bridgeFromEnv(env: NodeJS.ProcessEnv = process.env): ToolBridge {
  const socket = env[MCP_SOCKET_ENV];
  const jobId = env[MCP_JOB_ENV];
  const token = env[MCP_TOKEN_ENV];
  if (!socket || !jobId || !token) throw new Error(`${MCP_SOCKET_ENV}, ${MCP_JOB_ENV} and ${MCP_TOKEN_ENV} must be set`);
  return socketBridge(socket, jobId, token);
}
