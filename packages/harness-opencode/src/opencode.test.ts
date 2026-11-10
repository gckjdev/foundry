import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { opencodeBinary, startOpencodeServer } from "./adapter";
import { opencodeConfig, splitModel } from "./config";
import { OpencodeEventMapper } from "./events";

const S = "ses_1";

describe("opencode config", () => {
  it("allows everything except denied commands and wires the foundry MCP server", () => {
    const c = opencodeConfig({
      mcpServers: [
        { name: "foundry", command: "/usr/local/bin/foundry", args: ["mcp"], env: { FOUNDRY_JOB_ID: "j" } },
      ],
      permissions: { denyCommands: ["git push", "sudo"], allowWebFetch: false },
      model: "anthropic/claude-sonnet-4-5",
    });
    expect(c.permission).toMatchObject({
      edit: "allow",
      webfetch: "deny",
      bash: { "*": "allow", "git push": "deny", "git push *": "deny", sudo: "deny", "sudo *": "deny" },
    });
    expect(c.mcp?.foundry).toMatchObject({
      type: "local",
      command: ["/usr/local/bin/foundry", "mcp"],
      environment: { FOUNDRY_JOB_ID: "j" },
    });
    expect(splitModel("anthropic/claude-sonnet-4-5")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
    expect(splitModel("")).toBeUndefined();
  });

  it("denies edits for a read-only reviewer session", () => {
    const c = opencodeConfig({
      mcpServers: [],
      permissions: { denyCommands: ["git push"], allowWebFetch: false, allowEdits: false },
    });
    expect(c.permission).toMatchObject({ edit: "deny" });
  });
});

describe("OpencodeEventMapper", () => {
  it("emits each text part, tool call and step once, and ends on idle", () => {
    const m = new OpencodeEventMapper(S);
    const ev = (type: string, properties: unknown) => m.map({ type, properties } as never).events;
    expect(ev("message.updated", { info: { id: "u1", sessionID: S, role: "user" } })).toEqual([]);
    expect(
      ev("message.part.updated", {
        part: {
          id: "p0",
          sessionID: S,
          messageID: "u1",
          type: "text",
          text: "the prompt",
          time: { start: 1, end: 2 },
        },
      }),
    ).toEqual([]);
    ev("message.updated", {
      info: {
        id: "a1",
        sessionID: S,
        role: "assistant",
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
      },
    });
    const textPart = {
      id: "p1",
      sessionID: S,
      messageID: "a1",
      type: "text",
      text: "Looking",
      time: { start: 1 },
    };
    expect(ev("message.part.updated", { part: textPart })).toEqual([]);
    expect(
      ev("message.part.updated", {
        part: { ...textPart, text: "Looking at it", time: { start: 1, end: 3 } },
      }),
    ).toEqual([{ kind: "message", role: "agent", text: "Looking at it" }]);
    const tool = {
      id: "p2",
      sessionID: S,
      messageID: "a1",
      type: "tool",
      callID: "c1",
      tool: "bash",
      state: { status: "running", input: { command: "pnpm test" } },
    };
    expect(ev("message.part.updated", { part: tool })).toEqual([
      { kind: "tool_call", tool: "bash", summary: "pnpm test" },
    ]);
    expect(
      ev("message.part.updated", { part: { ...tool, state: { status: "completed", input: {} } } }),
    ).toEqual([]);
    expect(
      ev("message.part.updated", {
        part: {
          ...tool,
          id: "p3",
          callID: "c2",
          tool: "foundry_stage",
          state: { status: "running", input: {} },
        },
      })[0],
    ).toMatchObject({
      tool: "mcp__foundry__stage",
    });
    const step = {
      id: "p4",
      sessionID: S,
      messageID: "a1",
      type: "step-finish",
      cost: 0,
      tokens: { input: 1000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const usage = ev("message.part.updated", { part: step })[0] as { costUsd: number; model: string };
    expect(usage.model).toBe("anthropic/claude-sonnet-4-5");
    expect(usage.costUsd).toBeCloseTo((1000 * 3 + 100 * 15) / 1e6);
    expect(ev("message.part.updated", { part: { ...step, sessionID: "other" } })).toEqual([]);
    expect(m.map({ type: "session.idle", properties: { sessionID: "other" } }).idle).toBeUndefined();
    expect(m.map({ type: "session.idle", properties: { sessionID: S } }).idle).toBe(true);
    const retry = (attempt: number) =>
      m.map({
        type: "session.status",
        properties: { sessionID: S, status: { type: "retry", attempt, message: "plan expired" } },
      });
    expect(retry(1).error).toBeUndefined();
    expect(retry(3).error).toBe("plan expired");
    const late = { id: "p9", sessionID: S, messageID: "a1", type: "text", text: "Done" };
    expect(ev("message.part.updated", { part: late })).toEqual([]);
    expect(
      ev("message.updated", { info: { id: "a1", sessionID: S, role: "assistant", time: { completed: 5 } } }),
    ).toEqual([{ kind: "message", role: "agent", text: "Done" }]);
    expect(
      m.map({
        type: "session.error",
        properties: { sessionID: S, error: { name: "ApiError", data: { message: "402" } } },
      }).error,
    ).toBe("402");
  });
});

const hasOpencode = spawnSync(opencodeBinary(), ["--version"]).status === 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe.skipIf(!hasOpencode)("opencode serve (live, no model calls)", () => {
  it("starts in the worktree with the job config and serves sessions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "foundry-oc-"));
    spawnSync("git", ["init", "--quiet"], { cwd });
    const config = opencodeConfig({
      mcpServers: [],
      permissions: { denyCommands: ["git push"], allowWebFetch: true },
    });
    const port = await freePort();
    const { url, proc } = await startOpencodeServer({
      cwd,
      port,
      env: {},
      config,
      timeoutMs: 60_000,
    });
    try {
      const client = createOpencodeClient({ baseUrl: url, directory: cwd });
      const signal = AbortSignal.timeout(20_000);
      const created = await client.session.create({ body: { title: "t" }, signal });
      expect(created.data?.id).toMatch(/^ses/);
      const got = await client.config.get({ signal: AbortSignal.timeout(20_000) });
      expect((got.data as { share?: string }).share).toBe("disabled");
    } finally {
      if (proc.pid) process.kill(-proc.pid, "SIGTERM");
    }
  }, 90_000);
});
