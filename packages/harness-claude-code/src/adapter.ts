import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AsyncQueue,
  appendHarnessLog,
  deferred,
  type HarnessAdapter,
  type HarnessEvent,
  type HarnessSession,
  harnessLogJson,
  isDeniedCommand,
  type ResumeOpts,
  type SessionResult,
  type StartOpts,
} from "@foundry/harness-core";
import { platformExecutable, windowsExecutablePath } from "@foundry/os-adapters";
import { type ClaudeMessage, type NormalizeState, normalizeClaudeMessage } from "./normalize";

type QueryFn = (params: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<unknown> & {
  close?: () => void;
  interrupt?: () => Promise<unknown>;
};

const EDIT_TOOLS = ["Edit", "Write", "NotebookEdit", "MultiEdit"];

/** Built-in tools removed from the model's context for policy reasons. */
export function disallowedTools(opts: Pick<StartOpts, "permissions">): string[] {
  const out = opts.permissions.denyCommands.map((c) => `Bash(${c}:*)`);
  if (!opts.permissions.allowWebFetch) out.push("WebFetch", "WebSearch");
  if (opts.permissions.allowEdits === false) out.push(...EDIT_TOOLS);
  return out;
}

/** Headless permission handler: allow everything the policy does not deny. */
export function canUseTool(opts: Pick<StartOpts, "permissions">) {
  return async (toolName: string, input: Record<string, unknown>) => {
    if (
      toolName === "Bash" &&
      typeof input.command === "string" &&
      isDeniedCommand(input.command, opts.permissions.denyCommands)
    ) {
      return {
        behavior: "deny" as const,
        message: `Foundry policy forbids \`${input.command}\` in jobs. The runner handles git push.`,
      };
    }
    if ((toolName === "WebFetch" || toolName === "WebSearch") && !opts.permissions.allowWebFetch) {
      return { behavior: "deny" as const, message: "Web access is disabled by this repo's policy." };
    }
    if (opts.permissions.allowEdits === false && EDIT_TOOLS.includes(toolName)) {
      return { behavior: "deny" as const, message: "This session is read-only." };
    }
    return { behavior: "allow" as const, updatedInput: input };
  };
}

/**
 * `env` from `~/.claude/settings.json`. Jobs load only project settings (no user hooks or
 * permissions), but the machine's provider config (API key, base URL, model aliases) must apply.
 */
export function userSettingsEnv(home = homedir()): Record<string, string> {
  try {
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")) as {
      env?: Record<string, unknown>;
    };
    return Object.fromEntries(
      Object.entries(settings.env ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

/** True inside a `bun build --compile` binary, where the SDK's bundled engine is unavailable. */
function isCompiledBinary(): boolean {
  return import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN");
}

/** Explicit override, else the installed `claude` CLI when compiled, else the SDK's own engine. */
export function claudeExecutable(): string | undefined {
  if (process.env.FOUNDRY_CLAUDE_PATH) return process.env.FOUNDRY_CLAUDE_PATH;
  if (!isCompiledBinary()) return undefined;
  if (process.platform === "win32") return windowsExecutablePath("claude");
  const r = spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function claudeAuthPresent(env: NodeJS.ProcessEnv = { ...userSettingsEnv(), ...process.env }): boolean {
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN) return true;
  if (env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX) return true;
  if (existsSync(join(homedir(), ".claude", ".credentials.json"))) return true;
  if (process.platform === "darwin") {
    const r = spawnSync("security", ["find-generic-password", "-s", "Claude Code-credentials"], {
      stdio: "ignore",
    });
    if (r.status === 0) return true;
  }
  return false;
}

/**
 * Claude Code through the Claude Agent SDK, in-process (spec 5.8.1). The SDK runs the Claude Code
 * engine as a child process; sessions resume in place with `resume: <sessionId>`.
 */
export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = "claude-code" as const;
  private readonly costBySession = new Map<string, number>();
  private readonly running = new WeakMap<HarnessSession, { abort: AbortController; close?: () => void }>();

  constructor(private readonly loadQuery: () => Promise<QueryFn> = defaultLoadQuery) {}

  async detect() {
    const bin = process.env.FOUNDRY_CLAUDE_PATH ?? platformExecutable("claude");
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
    const version = r.status === 0 ? r.stdout.trim().split(/\s+/)[0] : undefined;
    // From source the SDK ships its own engine; a compiled runner needs the `claude` CLI.
    const installed = !isCompiledBinary() || !!claudeExecutable();
    return { installed, ...(version ? { version } : {}), authOk: claudeAuthPresent() };
  }

  start(opts: StartOpts) {
    return this.run(opts.prompt, opts, null);
  }

  resume(sessionId: string, message: string, opts: ResumeOpts) {
    return this.run(message, opts, sessionId);
  }

  async stop(session: HarnessSession) {
    const r = this.running.get(session);
    if (r) {
      r.abort.abort();
      r.close?.();
    }
    await session.done.catch(() => undefined);
  }

  private async run(prompt: string, opts: ResumeOpts, resume: string | null): Promise<HarnessSession> {
    const query = await this.loadQuery();
    const abort = new AbortController();
    const events = new AsyncQueue<HarnessEvent>();
    const id = deferred<string>();
    const done = deferred<SessionResult>();
    const state: NormalizeState = { reportedCostUsd: resume ? (this.costBySession.get(resume) ?? 0) : 0 };

    const redact = opts.redact ?? ((s: string) => s);
    const log = (section: string, body: string) => appendHarnessLog(opts.logFile, section, body, redact);
    log(
      "REQUEST query",
      harnessLogJson({ prompt, resume, model: opts.model, cwd: opts.cwd, systemPrompt: opts.systemPrompt }),
    );
    const executable = claudeExecutable();
    const q = query({
      prompt,
      options: {
        cwd: opts.cwd,
        ...(opts.model ? { model: opts.model } : {}),
        ...(resume ? { resume } : {}),
        systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPrompt },
        env: { ...userSettingsEnv(), ...process.env, ...opts.env },
        mcpServers: Object.fromEntries(
          opts.mcpServers.map((s) => [
            s.name,
            { type: "stdio", command: s.command, args: s.args, env: s.env ?? {} },
          ]),
        ),
        permissionMode: "default",
        canUseTool: canUseTool(opts),
        disallowedTools: disallowedTools(opts),
        settingSources: ["project"],
        abortController: abort,
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      },
    });
    const session: HarnessSession = { id: id.promise, events, done: done.promise };
    this.running.set(session, { abort, close: q.close?.bind(q) });

    void (async () => {
      let sessionId: string | null = resume;
      if (resume) id.resolve(resume);
      let result: SessionResult = { status: "ok" };
      try {
        for await (const raw of q) {
          const msg = raw as ClaudeMessage;
          log("CLAUDE message", harnessLogJson(msg));
          if (msg.session_id && !sessionId) {
            sessionId = msg.session_id;
            id.resolve(sessionId);
          }
          for (const e of normalizeClaudeMessage(msg, state)) events.push(e);
          if (msg.type === "result") {
            result = msg.is_error ? { status: "error", error: msg.result } : { status: "ok" };
          }
        }
      } catch (err) {
        result = abort.signal.aborted ? { status: "stopped" } : { status: "error", error: String(err) };
        log("CLAUDE error", String(err));
        if (result.status === "error") events.push({ kind: "error", message: String(err) });
      } finally {
        if (sessionId) this.costBySession.set(sessionId, state.reportedCostUsd);
        if (!sessionId) id.reject(new Error(result.error ?? "session ended before it started"));
        if (abort.signal.aborted) result = { ...result, status: "stopped" };
        log("RESPONSE session", harnessLogJson(result));
        events.close();
        done.resolve({ ...result, costUsd: state.reportedCostUsd });
      }
    })();
    id.promise.catch(() => undefined);
    return session;
  }
}

async function defaultLoadQuery(): Promise<QueryFn> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return sdk.query as unknown as QueryFn;
}
