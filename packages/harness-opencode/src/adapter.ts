import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AsyncQueue,
  deferred,
  type HarnessAdapter,
  type HarnessEvent,
  type HarnessSession,
  type ResumeOpts,
  type SessionResult,
  type StartOpts,
} from "@foundry/harness-core";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { opencodeConfig, splitModel } from "./config";
import { type OpencodeEvent, OpencodeEventMapper } from "./events";

const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "AWS_ACCESS_KEY_ID",
];

export function opencodeBinary(): string {
  return process.env.FOUNDRY_OPENCODE_PATH ?? "opencode";
}

function opencodeAuthPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  if (PROVIDER_ENV_KEYS.some((k) => env[k])) return true;
  const dataHome = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return existsSync(join(dataHome, "opencode", "auth.json"));
}

interface RunningServer {
  url: string;
  proc: ChildProcess;
  client: OpencodeClient;
  configKey: string;
}

/** Start `opencode serve` in the worktree and wait for its "listening on <url>" line. */
export function startOpencodeServer(opts: {
  cwd: string;
  port: number;
  env: Record<string, string>;
  config: object;
  timeoutMs?: number;
}): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn(opencodeBinary(), ["serve", "--hostname=127.0.0.1", `--port=${opts.port}`], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(opts.config) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      kill(proc);
      reject(new Error(`opencode serve did not start within ${opts.timeoutMs ?? 30_000}ms: ${output.slice(-500)}`));
    }, opts.timeoutMs ?? 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const m = /listening on\s+(https?:\/\/\S+)/.exec(output);
      if (m) {
        clearTimeout(timer);
        proc.stdout?.off("data", onData);
        resolve({ url: m[1]!, proc });
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", (c: Buffer) => {
      output += c.toString();
    });
    proc.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`opencode serve exited with ${code}: ${output.slice(-500)}`));
    });
  });
}

function kill(proc: ChildProcess): void {
  try {
    if (proc.pid) process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }
}

/**
 * OpenCode (spec 5.8.1): one `opencode serve` per job worktree on the job's leased port, driven
 * over HTTP with `@opencode-ai/sdk`. The server stays up between turns so nudges and verify
 * loops reuse it; sessions are stored by OpenCode, so a restarted server can resume them.
 */
export class OpencodeAdapter implements HarnessAdapter {
  readonly id = "opencode" as const;
  private readonly servers = new Map<string, RunningServer>();
  private readonly running = new WeakMap<HarnessSession, { client: OpencodeClient; sessionId: string; cwd: string; finish: () => void }>();

  async detect() {
    const r = spawnSync(opencodeBinary(), ["--version"], { encoding: "utf8", timeout: 15_000 });
    if (r.status !== 0) return { installed: false, authOk: false };
    return { installed: true, version: r.stdout.trim().split(/\s+/).at(-1)!, authOk: opencodeAuthPresent() };
  }

  start(opts: StartOpts) {
    return this.run(opts, null, opts.prompt);
  }

  resume(sessionId: string, message: string, opts: ResumeOpts) {
    return this.run(opts, sessionId, message);
  }

  async stop(session: HarnessSession) {
    const r = this.running.get(session);
    if (r) {
      await r.client.session.abort({ path: { id: r.sessionId } }).catch(() => {});
      r.finish();
    }
    await session.done.catch(() => undefined);
  }

  async release(cwd: string) {
    const s = this.servers.get(cwd);
    if (!s) return;
    this.servers.delete(cwd);
    kill(s.proc);
  }

  private async server(opts: ResumeOpts): Promise<RunningServer> {
    const config = opencodeConfig({ mcpServers: opts.mcpServers, permissions: opts.permissions, model: opts.model || undefined });
    const configKey = JSON.stringify(config);
    const existing = this.servers.get(opts.cwd);
    if (existing && existing.proc.exitCode === null && existing.configKey === configKey) return existing;
    if (existing) await this.release(opts.cwd);
    if (!opts.harnessPort) throw new Error("the OpenCode harness needs a leased port (harnessPort)");
    const { url, proc } = await startOpencodeServer({ cwd: opts.cwd, port: opts.harnessPort, env: opts.env, config });
    const client = createOpencodeClient({ baseUrl: url, directory: opts.cwd });
    const s: RunningServer = { url, proc, client, configKey };
    proc.once("exit", () => {
      if (this.servers.get(opts.cwd) === s) this.servers.delete(opts.cwd);
    });
    this.servers.set(opts.cwd, s);
    return s;
  }

  private async run(opts: ResumeOpts, resume: string | null, text: string): Promise<HarnessSession> {
    const srv = await this.server(opts);
    const { client } = srv;
    let sessionId = resume;
    if (!sessionId) {
      const created = await client.session.create({ body: { title: "Foundry job" } });
      if (!created.data) throw new Error(`OpenCode could not create a session: ${JSON.stringify(created.error)}`);
      sessionId = created.data.id;
    }
    const events = new AsyncQueue<HarnessEvent>();
    const done = deferred<SessionResult>();
    const abort = new AbortController();
    const mapper = new OpencodeEventMapper(sessionId, opts.model);
    let error: string | undefined;
    let finished = false;
    const finish = (result?: SessionResult) => {
      if (finished) return;
      finished = true;
      abort.abort();
      events.close();
      done.resolve(result ?? { status: "stopped" });
    };
    const session: HarnessSession = { id: Promise.resolve(sessionId), events, done: done.promise };
    this.running.set(session, { client, sessionId, cwd: opts.cwd, finish: () => finish({ status: "stopped" }) });

    // Subscribe before prompting so the turn's first events are not missed.
    const sub = await client.event.subscribe({ signal: abort.signal });
    void (async () => {
      try {
        for await (const raw of sub.stream as AsyncIterable<OpencodeEvent>) {
          const r = mapper.map(raw);
          for (const e of r.events) events.push(e);
          if (r.error) {
            error = r.error;
            if (raw.type === "session.status") {
              await client.session.abort({ path: { id: sessionId } }).catch(() => {});
              return finish({ status: "error", error });
            }
          }
          if (r.idle) return finish(error ? { status: "error", error } : { status: "ok" });
        }
        finish(error ? { status: "error", error } : { status: "stopped" });
      } catch (err) {
        finish(finished ? undefined : { status: "error", error: String(err) });
      }
    })();
    srv.proc.once("exit", (code) => finish({ status: "error", error: `opencode serve exited (${code})` }));

    const model = splitModel(opts.model);
    const sent = await client.session.promptAsync({
      path: { id: sessionId },
      body: { system: opts.systemPrompt, parts: [{ type: "text", text }], ...(model ? { model } : {}) },
    });
    if (sent.error) finish({ status: "error", error: `OpenCode rejected the prompt: ${JSON.stringify(sent.error)}` });
    return session;
  }
}
