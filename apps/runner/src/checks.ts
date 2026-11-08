import { spawn, spawnSync } from "node:child_process";
import { killTree } from "@foundry/os-adapters";

export interface CommandResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

const MAX_OUTPUT = 200_000;

/**
 * argv that runs `command` through the platform shell: PowerShell on Windows (recipe commands are
 * PowerShell there), `sh -c` on macOS/Linux.
 */
export function shellArgv(
  command: string,
  platform: NodeJS.Platform = process.platform,
  windowsShell: "pwsh" | "powershell.exe" = "powershell.exe",
): string[] {
  if (platform === "win32") return [windowsShell, "-NoProfile", "-NonInteractive", "-Command", command];
  return ["sh", "-c", command];
}

let cachedWindowsShell: "pwsh" | "powershell.exe" | null = null;

/** Prefer PowerShell 7 (`pwsh`) when it is on PATH; otherwise fall back to Windows PowerShell. */
function detectWindowsShell(): "pwsh" | "powershell.exe" {
  if (cachedWindowsShell) return cachedWindowsShell;
  cachedWindowsShell = "powershell.exe";
  if (process.platform !== "win32") return cachedWindowsShell;
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "ignore" });
  if (r.status === 0) cachedWindowsShell = "pwsh";
  return cachedWindowsShell;
}

/** Spawn options shared by the command runners: detached so a timeout can kill the whole tree. */
const SPAWN_OPTS = { detached: true, windowsHide: true } as const;

/**
 * Run a recipe command (`install`, a check, the dev server warmup) through the platform shell in
 * its own process group/tree, so a timeout kills everything it started.
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
  const argv = [...(opts.wrap ?? []), ...shellArgv(command, process.platform, detectWindowsShell())];
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, CI: "1" },
      ...SPAWN_OPTS,
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
      if (child.pid) killTree(child.pid, "SIGKILL");
      else child.kill("SIGKILL");
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
  const argv = [...(opts.wrap ?? []), ...shellArgv(command, process.platform, detectWindowsShell())];
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, CI: "1" },
    ...SPAWN_OPTS,
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
        if (child.pid) killTree(child.pid, signal);
        else child.kill(signal);
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
