import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Exec } from "./types";

/** Run a command and capture output; never throws (a missing binary is exit code 127). */
export const exec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(124);
    }, opts.timeoutMs ?? 30_000);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", () => done(127));
    child.on("close", (code) => done(code ?? 1));
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });

export async function which(
  run: Exec,
  bin: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform === "win32") return (await run("where.exe", [bin])).code === 0;
  return (await run("sh", ["-c", `command -v ${bin}`])).code === 0;
}

/** `taskkill` argv for killing a Windows process and its descendants. */
export function taskkillArgs(pid: number, force: boolean): string[] {
  return force ? ["/T", "/F", "/PID", String(pid)] : ["/T", "/PID", String(pid)];
}

/**
 * Kill a process and everything it started. POSIX signals the child's process group; Windows uses
 * `taskkill /T` (which has no process-group concept). Never throws.
 */
export function killTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") {
    spawnSync("taskkill", taskkillArgs(pid, signal === "SIGKILL"), { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/** Executable name for `spawn` on this platform: Windows resolves `.cmd` / `.exe` explicitly. */
export function platformExecutable(name: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return name;
  for (const candidate of [`${name}.cmd`, `${name}.exe`]) {
    if (spawnSync("where.exe", [candidate], { stdio: "ignore" }).status === 0) return candidate;
  }
  return name;
}

/** Full path to an executable on Windows (via `where.exe`), or undefined when it is absent. */
export function windowsExecutablePath(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") return undefined;
  for (const candidate of [`${name}.cmd`, `${name}.exe`]) {
    const r = spawnSync("where.exe", [candidate], { encoding: "utf8" });
    const first = r.stdout?.trim().split(/\r?\n/)[0]?.trim();
    if (r.status === 0 && first) return first;
  }
  return undefined;
}

/** Free space in MB on the filesystem holding `path`, via POSIX `df -Pk`. */
export async function dfFreeMb(run: Exec, path: string): Promise<number> {
  let target = path;
  while (target !== dirname(target) && !existsSync(target)) target = dirname(target);
  const r = await run("df", ["-Pk", target]);
  const line = r.stdout.trim().split("\n").at(-1) ?? "";
  const avail = Number(line.split(/\s+/)[3]);
  return Number.isFinite(avail) ? Math.floor(avail / 1024) : 0;
}
