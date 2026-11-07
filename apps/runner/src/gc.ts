import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PortLeases } from "./ports";
import type { LocalJobs } from "./state";
import type { Workspace } from "./workspace";

/** Parked worktrees older than this are dropped; the job resumes portably from the brief. */
export const PARKED_TTL_MS = 7 * 24 * 3600_000;

/**
 * Remove worktrees nobody needs (spec 5.9): orphans with no local record, jobs the control plane
 * no longer gives this runner, and parked jobs past their TTL.
 */
export async function collectGarbage(opts: {
  workspace: Workspace;
  localJobs: LocalJobs;
  ports: PortLeases;
  running: Set<string>;
  /** Jobs the control plane still considers parked on this runner; null when unknown. */
  keep?: Set<string> | null;
  now?: number;
}): Promise<string[]> {
  const now = opts.now ?? Date.now();
  const removed: string[] = [];
  for (const job of opts.localJobs.all()) {
    if (opts.running.has(job.jobId)) continue;
    const expired = now - Date.parse(job.updatedAt) > PARKED_TTL_MS;
    const unwanted = opts.keep ? !opts.keep.has(job.jobId) : false;
    if (job.state === "running" || expired || unwanted) {
      await opts.workspace.removeWorktree(job.repoFullName, job.jobId);
      opts.ports.release(job.jobId);
      opts.localJobs.delete(job.jobId);
      removed.push(job.jobId);
    }
  }
  const dir = join(opts.workspace.root, "worktrees");
  if (existsSync(dir)) {
    const known = new Set(opts.localJobs.all().map((j) => j.jobId));
    for (const name of readdirSync(dir)) {
      if (known.has(name) || opts.running.has(name)) continue;
      if (now - statSync(join(dir, name)).mtimeMs < 3600_000) continue;
      const { rm } = await import("node:fs/promises");
      await rm(join(dir, name), { recursive: true, force: true });
      opts.ports.release(name);
      removed.push(name);
    }
  }
  return removed;
}
