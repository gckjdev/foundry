import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveGitHubHostConfig } from "@foundry/shared/github-host";
import { git, gitOut } from "./git";

/** Paths the runner writes into worktrees that must never be committed. */
const LOCAL_EXCLUDES = [".env", ".foundry-local/"];

export function remoteUrl(fullName: string): string {
  return `${resolveGitHubHostConfig().gitBase}/${fullName}.git`;
}

function slug(fullName: string): string {
  return fullName.replace(/[^\w.-]+/g, "__");
}

/**
 * One bare mirror per repo, one `git worktree` per job (spec 5.9). Fetching into the mirror is
 * cheap after the first clone, and worktrees share its objects.
 */
export class Workspace {
  /** Concurrent callers share one fetch: readiness and job setup can ask for the same mirror. */
  private readonly fetches = new Map<string, Promise<string>>();

  constructor(readonly root: string) {}

  mirrorPath(fullName: string): string {
    return join(this.root, "mirrors", `${slug(fullName)}.git`);
  }

  worktreePath(jobId: string): string {
    return join(this.root, "worktrees", jobId);
  }

  ensureMirror(fullName: string, token?: string): Promise<string> {
    const mirror = this.mirrorPath(fullName);
    const inflight = this.fetches.get(mirror);
    if (inflight) return inflight;
    const fetch = this.fetchMirror(fullName, mirror, token).finally(() => this.fetches.delete(mirror));
    this.fetches.set(mirror, fetch);
    return fetch;
  }

  private async fetchMirror(fullName: string, mirror: string, token?: string): Promise<string> {
    if (!existsSync(join(mirror, "HEAD"))) {
      await mkdir(mirror, { recursive: true });
      await git(["init", "--bare", "--quiet"], { cwd: mirror });
      await git(["remote", "add", "origin", remoteUrl(fullName)], { cwd: mirror });
      await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: mirror });
      await appendFile(join(mirror, "info", "exclude"), `${LOCAL_EXCLUDES.join("\n")}\n`);
    }
    await git(["fetch", "--prune", "--quiet", "origin"], { cwd: mirror, token });
    return mirror;
  }

  async remoteBranchExists(mirror: string, branch: string): Promise<boolean> {
    const r = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], {
      cwd: mirror,
      allowFail: true,
    });
    return r.code === 0;
  }

  /**
   * Check out the job branch in a fresh worktree. An existing remote branch (portable resume)
   * is continued; otherwise the branch starts from the default branch.
   */
  async createWorktree(opts: {
    fullName: string;
    jobId: string;
    branch: string;
    defaultBranch: string;
    token?: string;
  }) {
    const mirror = await this.ensureMirror(opts.fullName, opts.token);
    const path = this.worktreePath(opts.jobId);
    await this.removeWorktree(opts.fullName, opts.jobId);
    await mkdir(join(this.root, "worktrees"), { recursive: true });
    const start = (await this.remoteBranchExists(mirror, opts.branch))
      ? `origin/${opts.branch}`
      : `origin/${opts.defaultBranch}`;
    await git(["worktree", "prune"], { cwd: mirror });
    await git(["worktree", "add", "--force", "-B", opts.branch, path, start], { cwd: mirror });
    return path;
  }

  /**
   * Check out a throwaway detached worktree of `origin/<branch>` (readiness checks) or of a
   * specific commit (the independent reviewer, which must see the job's local HEAD even before it
   * is pushed). It shares the repo mirror with job worktrees but has no branch, so it can never
   * collide with a job.
   */
  async createDetachedWorktree(opts: {
    fullName: string;
    branch: string;
    id: string;
    /** Start point; defaults to `origin/<branch>`. */
    commit?: string;
    token?: string;
    /** An already-fetched mirror for this repo; skips a redundant fetch. */
    mirror?: string;
  }): Promise<string> {
    const mirror = opts.mirror ?? (await this.ensureMirror(opts.fullName, opts.token));
    const path = this.worktreePath(opts.id);
    await this.removeWorktree(opts.fullName, opts.id);
    await mkdir(join(this.root, "worktrees"), { recursive: true });
    await git(["worktree", "prune"], { cwd: mirror });
    await git(["worktree", "add", "--force", "--detach", path, opts.commit ?? `origin/${opts.branch}`], {
      cwd: mirror,
    });
    return path;
  }

  async removeWorktree(fullName: string, jobId: string): Promise<void> {
    const mirror = this.mirrorPath(fullName);
    const path = this.worktreePath(jobId);
    if (existsSync(mirror))
      await git(["worktree", "remove", "--force", path], { cwd: mirror, allowFail: true });
    await rm(path, { recursive: true, force: true });
    if (existsSync(mirror)) await git(["worktree", "prune"], { cwd: mirror, allowFail: true });
  }

  /** Commit everything the agent changed. Returns true when a commit was made. */
  async commitAll(cwd: string, message: string): Promise<boolean> {
    await git(["add", "-A"], { cwd });
    const staged = await git(["diff", "--cached", "--quiet"], { cwd, allowFail: true });
    if (staged.code === 0) return false;
    await git(["commit", "--quiet", "--no-verify", "-m", message], { cwd });
    return true;
  }

  headSha(cwd: string): Promise<string> {
    return gitOut(["rev-parse", "HEAD"], { cwd });
  }

  async push(cwd: string, branch: string, token?: string): Promise<void> {
    await git(["push", "--quiet", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`], {
      cwd,
      token,
    });
  }

  /** `git diff` of the job branch against the merge base with the default branch. */
  async diffAgainstBase(cwd: string, defaultBranch: string): Promise<string> {
    return (await git(["diff", "--no-color", `origin/${defaultBranch}...HEAD`], { cwd })).stdout;
  }

  async readFileAt(
    mirror: string,
    ref: string,
    path: string,
  ): Promise<{ content: string; sha: string } | null> {
    const sha = await git(["rev-parse", "--verify", "--quiet", `${ref}:${path}`], {
      cwd: mirror,
      allowFail: true,
    });
    if (sha.code !== 0) return null;
    const content = await gitOut(["cat-file", "blob", sha.stdout.trim()], { cwd: mirror });
    return { content, sha: sha.stdout.trim() };
  }

  async readWorktreeFile(cwd: string, path: string): Promise<string | null> {
    try {
      return await readFile(join(cwd, path), "utf8");
    } catch {
      return null;
    }
  }
}
