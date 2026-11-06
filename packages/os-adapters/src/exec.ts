import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
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

export async function which(run: Exec, bin: string): Promise<boolean> {
  return (await run("sh", ["-c", `command -v ${bin}`])).code === 0;
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
