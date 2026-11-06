import type { HarnessEvent } from "@foundry/harness-core";

/** Loose view of the SDK messages Foundry reads; everything else is ignored. */
export interface ClaudeMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: { model?: string; content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
  description?: string;
  subagent_type?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  is_error?: boolean;
  result?: string;
  errors?: string[];
  model?: string;
}

const MAX_SUMMARY = 160;

export function summarizeToolInput(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description;
  if (typeof pick !== "string") return tool.startsWith("mcp__foundry__") ? JSON.stringify(i).slice(0, MAX_SUMMARY) : undefined;
  return pick.length > MAX_SUMMARY ? `${pick.slice(0, MAX_SUMMARY)}…` : pick;
}

export interface NormalizeState {
  /** Cumulative cost already reported for this session (resumed sessions carry earlier turns). */
  reportedCostUsd: number;
  model?: string;
}

/** Map one Claude Agent SDK message to Foundry events. */
export function normalizeClaudeMessage(msg: ClaudeMessage, state: NormalizeState): HarnessEvent[] {
  const out: HarnessEvent[] = [];
  if (msg.type === "system" && msg.subtype === "init") {
    if (msg.model) state.model = msg.model;
    return out;
  }
  if (msg.type === "system" && msg.subtype === "task_started") {
    out.push({ kind: "subagent_started", name: msg.subagent_type ?? msg.description ?? "subagent" });
    return out;
  }
  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text?.trim() && !msg.parent_tool_use_id) {
        out.push({ kind: "message", role: "agent", text: block.text.trim() });
      } else if (block.type === "tool_use" && block.name) {
        const summary = summarizeToolInput(block.name, block.input);
        out.push({ kind: "tool_call", tool: block.name, ...(summary ? { summary } : {}) });
      }
    }
    return out;
  }
  if (msg.type === "result") {
    const total = msg.total_cost_usd ?? 0;
    const delta = Math.max(0, total - state.reportedCostUsd);
    state.reportedCostUsd = Math.max(state.reportedCostUsd, total);
    const u = msg.usage ?? {};
    out.push({
      kind: "usage",
      ...(state.model ? { model: state.model } : {}),
      tokensIn: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      tokensOut: u.output_tokens ?? 0,
      costUsd: delta,
    });
    if (msg.is_error || (msg.subtype && msg.subtype !== "success")) {
      out.push({ kind: "error", message: msg.errors?.join("; ") || msg.result || msg.subtype || "harness error" });
    }
  }
  return out;
}
