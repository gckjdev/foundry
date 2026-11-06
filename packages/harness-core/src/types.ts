import type { FoundryEvent, Policy } from "@foundry/shared";

export type HarnessId = "claude-code" | "opencode";

/** Normalized events every adapter emits; a subset of the Foundry event union. */
export type HarnessEvent = Extract<
  FoundryEvent,
  { kind: "message" | "tool_call" | "usage" | "subagent_started" | "error" | "log" }
>;

/** A stdio MCP server handed to the harness (always includes the per-job `foundry` server). */
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface PermissionPolicy {
  /** Shell command prefixes the agent may never run. */
  denyCommands: string[];
  allowWebFetch: boolean;
}

export interface StartOpts {
  /** The job's worktree. */
  cwd: string;
  /** e.g. "claude-opus-4-5" or "openai/gpt-5"; empty means the harness default. */
  model: string;
  /** Playbook plus repo skills. */
  systemPrompt: string;
  /** Ticket body or handoff brief. */
  prompt: string;
  /** FOUNDRY_PORT, API keys, ... */
  env: Record<string, string>;
  mcpServers: McpServerConfig[];
  permissions: PermissionPolicy;
  /** Leased port the harness may use for its own server (OpenCode). */
  harnessPort?: number;
}

export type ResumeOpts = Omit<StartOpts, "prompt">;

export interface SessionResult {
  status: "ok" | "error" | "stopped";
  costUsd?: number;
  error?: string;
}

export interface HarnessSession {
  /** Native session id, stored for sticky resume. Resolves once the harness reports it. */
  id: Promise<string>;
  events: AsyncIterable<HarnessEvent>;
  done: Promise<SessionResult>;
}

export interface HarnessDetection {
  installed: boolean;
  version?: string;
  authOk: boolean;
}

/** Spec 5.8.1: every harness sits behind this interface. */
export interface HarnessAdapter {
  id: HarnessId;
  detect(): Promise<HarnessDetection>;
  start(opts: StartOpts): Promise<HarnessSession>;
  resume(sessionId: string, message: string, opts: ResumeOpts): Promise<HarnessSession>;
  /** Graceful, then kills the process group. */
  stop(session: HarnessSession): Promise<void>;
  /** The job is done with this worktree: free anything kept alive between turns (e.g. a server). */
  release?(cwd: string): Promise<void>;
}

export function permissionsFromPolicy(policy: Policy): PermissionPolicy {
  return { denyCommands: policy.permissions.deny_commands, allowWebFetch: policy.permissions.allow_web_fetch };
}

/** True when a shell command starts with one of the denied prefixes. */
export function isDeniedCommand(command: string, deny: string[]): boolean {
  const c = command.trim().replace(/\s+/g, " ");
  return deny.some((d) => {
    const prefix = d.trim().replace(/\s+/g, " ");
    return c === prefix || c.startsWith(`${prefix} `) || c.includes(`&& ${prefix}`) || c.includes(`; ${prefix}`);
  });
}
