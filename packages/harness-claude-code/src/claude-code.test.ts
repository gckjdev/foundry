import type { HarnessEvent } from "@foundry/harness-core";
import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter, canUseTool, disallowedTools } from "./adapter";
import { normalizeClaudeMessage } from "./normalize";

// Shapes recorded from @anthropic-ai/claude-agent-sdk 0.3.x streams.
const recorded = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-abc",
    model: "claude-sonnet-4-5",
    cwd: "/w",
    tools: [],
  },
  {
    type: "assistant",
    session_id: "sess-abc",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text: "I'll look at the login handler." }] },
  },
  {
    type: "assistant",
    session_id: "sess-abc",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test --filter auth" } }] },
  },
  {
    type: "system",
    subtype: "task_started",
    session_id: "sess-abc",
    task_id: "t1",
    description: "explore",
    subagent_type: "Explore",
  },
  {
    type: "assistant",
    session_id: "sess-abc",
    parent_tool_use_id: null,
    message: {
      content: [{ type: "tool_use", name: "mcp__foundry__stage", input: { name: "implementing" } }],
    },
  },
  {
    type: "result",
    subtype: "success",
    session_id: "sess-abc",
    is_error: false,
    total_cost_usd: 0.42,
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800 },
    result: "done",
  },
];

describe("normalizeClaudeMessage", () => {
  it("maps a recorded stream to Foundry events", () => {
    const state = { reportedCostUsd: 0 };
    const events = recorded.flatMap((m) => normalizeClaudeMessage(m, state));
    expect(events).toEqual([
      { kind: "message", role: "agent", text: "I'll look at the login handler." },
      { kind: "tool_call", tool: "Bash", summary: "pnpm test --filter auth" },
      { kind: "subagent_started", name: "Explore" },
      { kind: "tool_call", tool: "mcp__foundry__stage", summary: '{"name":"implementing"}' },
      { kind: "usage", model: "claude-sonnet-4-5", tokensIn: 2000, tokensOut: 300, costUsd: 0.42 },
    ]);
  });

  it("reports only the cost added since the last result (resumed sessions carry totals)", () => {
    const state = { reportedCostUsd: 0.42 };
    const [usage] = normalizeClaudeMessage(
      { type: "result", subtype: "success", total_cost_usd: 0.5, usage: {} },
      state,
    );
    expect(usage).toMatchObject({ costUsd: expect.closeTo(0.08, 5) });
  });
});

describe("permissions", () => {
  const opts = { permissions: { denyCommands: ["git push", "sudo"], allowWebFetch: false } };
  it("builds disallowed tool rules", () => {
    expect(disallowedTools(opts)).toEqual(["Bash(git push:*)", "Bash(sudo:*)", "WebFetch", "WebSearch"]);
  });
  it("denies policy-forbidden commands at runtime", async () => {
    const check = canUseTool(opts);
    expect((await check("Bash", { command: "git push origin x" })).behavior).toBe("deny");
    expect((await check("Bash", { command: "pnpm test" })).behavior).toBe("allow");
    expect((await check("WebFetch", { url: "x" })).behavior).toBe("deny");
  });
});

describe("ClaudeCodeAdapter with a stubbed SDK", () => {
  it("streams events, resolves the session id and passes resume", async () => {
    const seen: Record<string, unknown>[] = [];
    const adapter = new ClaudeCodeAdapter(async () => (params) => {
      seen.push(params.options ?? {});
      return (async function* () {
        for (const m of recorded) yield m;
      })();
    });
    const base = {
      cwd: "/w",
      model: "",
      systemPrompt: "PLAYBOOK",
      env: { FOUNDRY_PORT: "4100" },
      mcpServers: [{ name: "foundry", command: "foundry", args: ["mcp"] }],
      permissions: { denyCommands: [], allowWebFetch: true },
    };
    const s = await adapter.start({ ...base, prompt: "fix it" });
    const events: HarnessEvent[] = [];
    for await (const e of s.events) events.push(e);
    expect(await s.id).toBe("sess-abc");
    expect((await s.done).status).toBe("ok");
    expect(events.at(-1)).toMatchObject({ kind: "usage", costUsd: 0.42 });
    expect(seen[0]).toMatchObject({
      cwd: "/w",
      systemPrompt: { type: "preset", preset: "claude_code", append: "PLAYBOOK" },
      mcpServers: { foundry: { type: "stdio", command: "foundry", args: ["mcp"] } },
    });

    const r = await adapter.resume("sess-abc", "answer: CSV", base);
    for await (const _ of r.events) {
      // drain
    }
    expect(seen[1]).toMatchObject({ resume: "sess-abc" });
    // Same cumulative total as before, so no new cost is reported.
    expect((await r.done).costUsd).toBe(0.42);
  });
});
