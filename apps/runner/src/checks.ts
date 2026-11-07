import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

const MAX_OUTPUT = 200_000;

/**
 * Run a recipe command (`install`, a check, the dev server warmup) through `sh -c` in its own
 * process group, so a timeout kills everything it started.
 */
export function runCommand(
  command: string,
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
    wrap?: string[];
  },
): Promise<CommandResult> {
  const started = Date.now();
  const argv = [...(opts.wrap ?? []), "sh", "-c", command];
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, CI: "1" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (d: Buffer) => {
      output += d.toString();
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    opts.signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: String(err), durationMs: Date.now() - started, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", kill);
      resolve({
        exitCode: code,
        output: output.slice(-MAX_OUTPUT),
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}

/** A long-running recipe command (the dev server): stop it without waiting for it to exit. */
export interface RunningCommand {
  /** `null` while running, otherwise the exit code (`-1` when it could not start). */
  readonly exitCode: number | null;
  output(): string;
  /** Kill the whole process group. Safe to call more than once. */
  stop(): void;
}

/**
 * Start a recipe command detached in its own process group so `stop()` can kill everything it
 * spawned (spec 5.3: the runner starts the app during verifying). Unlike `runCommand` this does
 * not wait for the command to finish.
 */
export function startCommand(
  command: string,
  opts: { cwd: string; env: Record<string, string>; wrap?: string[] },
): RunningCommand {
  const argv = [...(opts.wrap ?? []), "sh", "-c", command];
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, CI: "1" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exitCode: number | null = null;
  let stopped = false;
  const append = (d: Buffer) => {
    output += d.toString();
    if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (err) => {
    exitCode = -1;
    output += String(err);
  });
  child.on("close", (code) => {
    // A spawn error sets -1 first; keep that rather than the null `close` reports.
    if (exitCode === null) exitCode = code;
  });
  return {
    get exitCode() {
      return exitCode;
    },
    output: () => output.slice(-MAX_OUTPUT),
    stop() {
      if (stopped) return;
      stopped = true;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      kill("SIGTERM");
      // A dev server that ignores SIGTERM must not keep the runner alive or hold the port.
      const timer = setTimeout(() => kill("SIGKILL"), 2_000);
      timer.unref?.();
    },
  };
}

export function tail(text: string, chars = 8_000): string {
  return text.length <= chars ? text : `…${text.slice(-chars)}`;
}
