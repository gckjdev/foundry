import { spawn } from "node:child_process";
import { gitProxyArgs, httpProxyEnv } from "@foundry/shared/proxy";

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
    super(
      `git ${args.filter((a) => !a.startsWith("http.extraheader")).join(" ")} failed (${result.code}): ${result.stderr.trim()}`,
    );
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

const NETWORK = new Set(["fetch", "push", "clone", "ls-remote"]);

function isNetworkGit(args: string[]): boolean {
  return NETWORK.has(args[0] ?? "");
}

/** Local `file://` fixtures (tests) must not go through the HTTP proxy. */
export function gitRemoteUsesHttpProxy(gitBase = process.env.FOUNDRY_GIT_BASE): boolean {
  if (!gitBase) return true;
  return /^https?:/i.test(gitBase);
}

function isTransientGitFailure(result: GitResult): boolean {
  const s = result.stderr.toLowerCase();
  return /empty reply|unable to access|timed out|timeout|connection reset|could not resolve|ssl|502|503|429|early eof/.test(
    s,
  );
}

function spawnGit(args: string[], opts: GitOpts): Promise<GitResult> {
  const proxy = gitRemoteUsesHttpProxy();
  const full = [...(proxy ? gitProxyArgs() : []), ...authArgs(opts.token), ...args];
  return new Promise((resolve, reject) => {
    const child = spawn("git", full, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...(proxy ? httpProxyEnv() : {}),
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
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(opts.input ?? "");
  });
}

export async function git(args: string[], opts: GitOpts): Promise<GitResult> {
  const attempts = isNetworkGit(args) ? 5 : 1;
  let last: GitResult | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await spawnGit(args, opts);
    if (result.code === 0 || opts.allowFail) return result;
    last = result;
    if (attempt === attempts || !isTransientGitFailure(result)) break;
    await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
  }
  throw new GitError(args, last!);
}

export async function gitOut(args: string[], opts: GitOpts): Promise<string> {
  return (await git(args, opts)).stdout.trim();
}
