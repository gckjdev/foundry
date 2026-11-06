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
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number; signal?: AbortSignal; wrap?: string[] },
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
      resolve({ exitCode: code, output: output.slice(-MAX_OUTPUT), durationMs: Date.now() - started, timedOut });
    });
  });
}

export function tail(text: string, chars = 8_000): string {
  return text.length <= chars ? text : `…${text.slice(-chars)}`;
}
