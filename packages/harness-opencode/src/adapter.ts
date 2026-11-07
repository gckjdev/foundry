import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  type ResumeOpts,
  type SessionResult,
  type StartOpts,
} from "@foundry/harness-core";
import { killTree, platformExecutable } from "@foundry/os-adapters";
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
  return process.env.FOUNDRY_OPENCODE_PATH ?? platformExecutable("opencode");
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

const DEFAULT_START_TIMEOUT_MS = 60_000;

/**
 * Start `opencode serve` in the worktree. Readiness is an HTTP response, not a listening port:
 * opencode binds its socket before the router finishes initialising, so a request sent in that
 * window hangs. Polling /config (auth-less) until it returns 2xx guarantees the next request
 * (e.g. session.create) is actually served.
 */
export function startOpencodeServer(opts: {
  cwd: string;
  port: number;
  env: Record<string, string>;
  config: object;
  timeoutMs?: number;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => void;
}): Promise<{ url: string; proc: ChildProcess }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const url = `http://127.0.0.1:${opts.port}`;
  const proc = spawn(opencodeBinary(), ["serve", "--hostname=127.0.0.1", `--port=${opts.port}`], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(opts.config) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  return new Promise((resolve, reject) => {
    let output = "";
    let started = false;
    const finish = () => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      resolve({ url, proc });
    };
    const fail = (err: Error) => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      kill(proc);
      fail(new Error(`opencode serve did not start within ${timeoutMs}ms: ${output.slice(-500)}`));
    }, timeoutMs);
    // Poll the HTTP server until it actually answers, retrying every 200ms with a 1s
    // per-attempt timeout. Connection-refused (not yet bound) and timeouts (bound but not
    // dispatching yet) both mean "not ready".
    const poll = async () => {
      if (started) return;
      try {
        const res = await fetch(`${url}/config`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          finish();
          return;
        }
      } catch {
        // not ready yet
      }
      setTimeout(poll, 200);
    };
    void poll();
    const onChunk = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const s = chunk.toString();
      output += s;
      opts.onLog?.(stream, s);
    };
    proc.stdout?.on("data", onChunk("stdout"));
    proc.stderr?.on("data", onChunk("stderr"));
    proc.once("error", (err) => fail(err));
    proc.once("exit", (code, signal) => {
      fail(new Error(`opencode serve exited with ${code ?? signal}: ${output.slice(-500)}`));
    });
  });
}

function kill(proc: ChildProcess): void {
  if (proc.pid) killTree(proc.pid, "SIGTERM");
  else proc.kill("SIGTERM");
}

/**
 * OpenCode (spec 5.8.1): one `opencode serve` per job worktree on the job's leased port, driven
 * over HTTP with `@opencode-ai/sdk`. The server stays up between turns so nudges and verify
 * loops reuse it; sessions are stored by OpenCode, so a restarted server can resume them.
 */
export class OpencodeAdapter implements HarnessAdapter {
  readonly id = "opencode" as const;
  private readonly servers = new Map<string, RunningServer>();
  private readonly running = new WeakMap<
    HarnessSession,
    { client: OpencodeClient; sessionId: string; cwd: string; finish: () => void }
  >();

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
    const config = opencodeConfig({
      mcpServers: opts.mcpServers,
      permissions: opts.permissions,
      model: opts.model || undefined,
    });
    const configKey = JSON.stringify(config);
    const existing = this.servers.get(opts.cwd);
    if (existing && existing.proc.exitCode === null && existing.configKey === configKey) return existing;
    if (existing) await this.release(opts.cwd);
    if (!opts.harnessPort) throw new Error("the OpenCode harness needs a leased port (harnessPort)");
    const redact = opts.redact ?? ((s: string) => s);
    const { url, proc } = await startOpencodeServer({
      cwd: opts.cwd,
      port: opts.harnessPort,
      env: opts.env,
      config,
      onLog: (stream, chunk) => appendHarnessLog(opts.logFile, `OPENCODE ${stream}`, chunk, redact),
    });
    const client = createOpencodeClient({ baseUrl: url, directory: opts.cwd });
    const s: RunningServer = { url, proc, client, configKey };
    proc.once("exit", () => {
      if (this.servers.get(opts.cwd) === s) this.servers.delete(opts.cwd);
    });
    this.servers.set(opts.cwd, s);
    return s;
  }

  private async run(opts: ResumeOpts, resume: string | null, text: string): Promise<HarnessSession> {
    const redact = opts.redact ?? ((s: string) => s);
    const log = (section: string, body: string) => appendHarnessLog(opts.logFile, section, body, redact);
    const srv = await this.server(opts);
    const { client } = srv;
    let sessionId = resume;
    if (!sessionId) {
      const created = await client.session.create({ body: { title: "Foundry job" } });
      if (!created.data)
        throw new Error(`OpenCode could not create a session: ${JSON.stringify(created.error)}`);
      sessionId = created.data.id;
      log("OPENCODE session.create", sessionId);
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
    this.running.set(session, {
      client,
      sessionId,
      cwd: opts.cwd,
      finish: () => finish({ status: "stopped" }),
    });

    // Subscribe before prompting so the turn's first events are not missed.
    const sub = await client.event.subscribe({ signal: abort.signal });
    void (async () => {
      try {
        for await (const raw of sub.stream as AsyncIterable<OpencodeEvent>) {
          log("OPENCODE event", harnessLogJson(raw));
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
        log("OPENCODE subscribe error", String(err));
        finish(finished ? undefined : { status: "error", error: String(err) });
      }
    })();
    srv.proc.once("exit", (code, signal) => {
      const msg = `opencode serve exited (code=${code} signal=${signal})`;
      log("OPENCODE serve exit", msg);
      finish({ status: "error", error: msg });
    });

    const model = splitModel(opts.model);
    const body = {
      system: opts.systemPrompt,
      parts: [{ type: "text" as const, text }],
      ...(model ? { model } : {}),
    };
    log("REQUEST promptAsync", harnessLogJson({ sessionId, resume, model: opts.model, body }));
    const sent = await client.session.promptAsync({
      path: { id: sessionId },
      body,
    });
    if (sent.error) {
      log("RESPONSE promptAsync error", harnessLogJson(sent.error));
      finish({ status: "error", error: `OpenCode rejected the prompt: ${JSON.stringify(sent.error)}` });
    }
    return session;
  }
}
