import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What the runner remembers about a job between claims (sticky resume, GC). */
export interface LocalJob {
  jobId: string;
  repoFullName: string;
  worktree: string;
  sessionId: string | null;
  portBase: number | null;
  /** "parked": waiting for an answer or a schedule window, worktree kept for sticky resume. */
  state: "running" | "parked";
  updatedAt: string;
}

export class LocalJobs {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private stem(jobId: string): string {
    return jobId.replace(/[^\w-]/g, "");
  }

  private file(jobId: string): string {
    return join(this.dir, `${this.stem(jobId)}.json`);
  }

  /** Full coding-agent request/response transcript for this job. */
  harnessLog(jobId: string): string {
    return join(this.dir, `${this.stem(jobId)}.harness.log`);
  }

  get(jobId: string): LocalJob | null {
    const f = this.file(jobId);
    if (!existsSync(f)) return null;
    try {
      return JSON.parse(readFileSync(f, "utf8")) as LocalJob;
    } catch {
      return null;
    }
  }

  put(job: Omit<LocalJob, "updatedAt">): void {
    writeFileSync(
      this.file(job.jobId),
      JSON.stringify({ ...job, updatedAt: new Date().toISOString() }, null, 2),
    );
  }

  delete(jobId: string): void {
    rmSync(this.file(jobId), { force: true });
  }

  all(): LocalJob[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.get(f.slice(0, -5)))
      .filter((j): j is LocalJob => j !== null);
  }
}
