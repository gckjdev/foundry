import type { HarnessEvent } from "@foundry/harness-core";
import { costFromUsage } from "@foundry/shared";

const MAX_SUMMARY = 200;

/** The slice of OpenCode server events the adapter reads. */
export type OpencodeEvent =
  | { type: "message.part.updated"; properties: { part: OpencodePart } }
  | {
      type: "message.updated";
      properties: {
        info: {
          id: string;
          sessionID: string;
          role: string;
          modelID?: string;
          providerID?: string;
          time?: { completed?: number };
        };
      };
    }
  | { type: "session.idle"; properties: { sessionID: string } }
  | {
      type: "session.status";
      properties: { sessionID: string; status: { type: string; attempt?: number; message?: string } };
    }
  | {
      type: "session.error";
      properties: { sessionID?: string; error?: { name?: string; data?: { message?: string } } };
    }
  | { type: string; properties?: unknown };

export type OpencodePart =
  | {
      id: string;
      sessionID: string;
      messageID: string;
      type: "text";
      text: string;
      synthetic?: boolean;
      time?: { start: number; end?: number };
    }
  | {
      id: string;
      sessionID: string;
      messageID: string;
      type: "tool";
      callID: string;
      tool: string;
      state: { status: string; input?: Record<string, unknown>; title?: string; error?: string };
    }
  | {
      id: string;
      sessionID: string;
      messageID: string;
      type: "step-finish";
      cost: number;
      tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
    }
  | { id: string; sessionID: string; messageID: string; type: "agent"; name: string }
  | { id: string; sessionID: string; messageID: string; type: string };

function summarize(input: Record<string, unknown> | undefined, title?: string): string | undefined {
  const pick =
    input?.command ??
    input?.filePath ??
    input?.path ??
    input?.pattern ??
    input?.url ??
    input?.description ??
    title;
  if (typeof pick !== "string") return undefined;
  return pick.length > MAX_SUMMARY ? `${pick.slice(0, MAX_SUMMARY)}…` : pick;
}

export type MapResult = { events: HarnessEvent[]; idle?: boolean; error?: string };

/** Provider retries before the turn is failed (e.g. an expired plan retries forever). */
export const MAX_PROVIDER_RETRIES = 3;

/**
 * Turns the OpenCode event stream for one session into Foundry events. Parts are updated many
 * times while streaming, so each text part, tool call and step is emitted once.
 */
export class OpencodeEventMapper {
  private readonly seen = new Set<string>();
  private readonly userMessages = new Set<string>();
  /** Latest streamed text per assistant part, emitted when the part or its message completes. */
  private readonly pendingText = new Map<string, { messageID: string; text: string }>();
  private model: string;

  constructor(
    readonly sessionId: string,
    model = "",
  ) {
    this.model = model;
  }

  map(e: OpencodeEvent): MapResult {
    switch (e.type) {
      case "message.updated": {
        const info = (e as Extract<OpencodeEvent, { type: "message.updated" }>).properties.info;
        if (info.sessionID !== this.sessionId) return { events: [] };
        if (info.role === "user") this.userMessages.add(info.id);
        if (info.modelID) this.model = info.providerID ? `${info.providerID}/${info.modelID}` : info.modelID;
        return { events: info.time?.completed ? this.flushText(info.id) : [] };
      }
      case "session.status": {
        const p = (e as Extract<OpencodeEvent, { type: "session.status" }>).properties;
        if (p.sessionID !== this.sessionId || p.status.type !== "retry") return { events: [] };
        const message = `provider retry ${p.status.attempt ?? "?"}: ${p.status.message ?? "unknown error"}`;
        const events: HarnessEvent[] = [{ kind: "log", level: "warn", message }];
        if ((p.status.attempt ?? 0) >= MAX_PROVIDER_RETRIES) {
          events.push({ kind: "error", message: p.status.message ?? "provider kept failing" });
          return { events, error: p.status.message ?? "provider kept failing" };
        }
        return { events };
      }
      case "message.part.updated":
        return this.part((e as Extract<OpencodeEvent, { type: "message.part.updated" }>).properties.part);
      case "session.idle": {
        const p = (e as Extract<OpencodeEvent, { type: "session.idle" }>).properties;
        return p.sessionID === this.sessionId ? { events: this.flushText(), idle: true } : { events: [] };
      }
      case "session.error": {
        const p = (e as Extract<OpencodeEvent, { type: "session.error" }>).properties;
        if (p.sessionID && p.sessionID !== this.sessionId) return { events: [] };
        if (p.error?.name === "MessageAbortedError") return { events: [] };
        const message = p.error?.data?.message ?? p.error?.name ?? "OpenCode session error";
        return { events: [{ kind: "error", message }], error: message };
      }
      default:
        return { events: [] };
    }
  }

  private once(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  private emitText(partId: string): HarnessEvent[] {
    const t = this.pendingText.get(partId);
    this.pendingText.delete(partId);
    if (!t?.text.trim() || !this.once(`text:${partId}`)) return [];
    return [{ kind: "message", role: "agent", text: t.text }];
  }

  private flushText(messageID?: string): HarnessEvent[] {
    return [...this.pendingText.entries()]
      .filter(([, t]) => !messageID || t.messageID === messageID)
      .flatMap(([id]) => this.emitText(id));
  }

  private part(part: OpencodePart): MapResult {
    if (part.sessionID !== this.sessionId || this.userMessages.has(part.messageID)) return { events: [] };
    if (part.type === "text") {
      const p = part as Extract<OpencodePart, { type: "text" }>;
      if (p.synthetic || this.seen.has(`text:${p.id}`)) return { events: [] };
      this.pendingText.set(p.id, { messageID: p.messageID, text: p.text });
      return { events: p.time?.end ? this.emitText(p.id) : [] };
    }
    if (part.type === "tool") {
      const p = part as Extract<OpencodePart, { type: "tool" }>;
      if (p.state.status === "pending" || !this.once(`tool:${p.callID}`)) return { events: [] };
      const tool = p.tool.startsWith("foundry_")
        ? `mcp__foundry__${p.tool.slice("foundry_".length)}`
        : p.tool;
      const summary = summarize(p.state.input, p.state.title);
      const out: HarnessEvent[] = [{ kind: "tool_call", tool, ...(summary ? { summary } : {}) }];
      if (p.tool === "task") out.push({ kind: "subagent_started", name: summary ?? "task" });
      return { events: out };
    }
    if (part.type === "step-finish") {
      const p = part as Extract<OpencodePart, { type: "step-finish" }>;
      if (!this.once(`step:${p.id}`)) return { events: [] };
      const tokensIn = p.tokens.input + p.tokens.cache.read + p.tokens.cache.write;
      const tokensOut = p.tokens.output + p.tokens.reasoning;
      const costUsd = p.cost > 0 ? p.cost : (costFromUsage(this.model, tokensIn, tokensOut) ?? 0);
      return {
        events: [
          { kind: "usage", ...(this.model ? { model: this.model } : {}), tokensIn, tokensOut, costUsd },
        ],
      };
    }
    return { events: [] };
  }
}
