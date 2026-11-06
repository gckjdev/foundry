import { spawn } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly result: GitResult,
  ) {
    super(`git ${args.filter((a) => !a.startsWith("http.extraheader")).join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
  }
}

export interface GitOpts {
  cwd: string;
  /** Installation token sent as an HTTP header, never written to disk or remote URLs. */
  token?: string;
  input?: string;
  allowFail?: boolean;
  env?: Record<string, string>;
}

export function authArgs(token: string | undefined): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraheader=AUTHORIZATION: basic ${basic}`];
}

export function git(args: string[], opts: GitOpts): Promise<GitResult> {
  const full = [...authArgs(opts.token), ...args];
  return new Promise((resolve, reject) => {
    const child = spawn("git", full, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Foundry",
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "foundry@users.noreply.github.com",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Foundry",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "foundry@users.noreply.github.com",
        ...opts.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !opts.allowFail) reject(new GitError(args, result));
      else resolve(result);
    });
    child.stdin.end(opts.input ?? "");
  });
}

export async function gitOut(args: string[], opts: GitOpts): Promise<string> {
  return (await git(args, opts)).stdout.trim();
}
