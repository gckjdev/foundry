import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type FoundryToolName, mcpUsesTcp, type ToolCallRequest, type ToolReply } from "@foundry/mcp-foundry";

export type ToolHandler = (tool: FoundryToolName, args: Record<string, unknown>) => Promise<ToolReply>;

/**
 * The runner side of the `foundry` MCP server: each job's `foundry mcp` process POSTs tool calls
 * to a Unix socket (POSIX) or a loopback TCP port (Windows). A per-job token keeps one job's agent
 * from reporting on another's job.
 */
export class ToolServer {
  private readonly handlers = new Map<string, { token: string; handler: ToolHandler }>();
  private server: Server | null = null;
  /** TCP origin once `start()` binds on Windows; null while using the Unix socket. */
  url: string | null = null;

  constructor(readonly socketPath: string) {}

  async start(): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", async () => {
        const reply = (status: number, r: ToolReply) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(r));
        };
        try {
          const call = JSON.parse(body) as ToolCallRequest;
          const entry = this.handlers.get(call.jobId);
          if (!entry || entry.token !== call.token)
            return reply(403, { text: "This job is not running on this runner.", isError: true });
          reply(200, await entry.handler(call.tool, call.args ?? {}));
        } catch (err) {
          reply(500, { text: `Runner error: ${String(err)}`, isError: true });
        }
      });
    });
    if (mcpUsesTcp()) {
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(0, "127.0.0.1", () => {
          const addr = this.server!.address();
          if (addr && typeof addr === "object") this.url = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    } else {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(this.socketPath, () => resolve());
      });
    }
  }

  register(jobId: string, handler: ToolHandler): string {
    const token = randomBytes(24).toString("hex");
    this.handlers.set(jobId, { token, handler });
    return token;
  }

  unregister(jobId: string): void {
    this.handlers.delete(jobId);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    if (this.url === null && existsSync(this.socketPath)) unlinkSync(this.socketPath);
  }
}
