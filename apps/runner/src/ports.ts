import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

export const PORT_RANGE_START = 41_000;
export const PORT_BLOCK = 10;
export const PORT_BLOCKS = 200;

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => srv.close(() => resolve(true)));
  });
}

/**
 * Each job gets a block of PORT_BLOCK ports (`FOUNDRY_PORT` is the first), so dev servers of
 * concurrent jobs never collide. Leases persist in a JSON file so a restarted daemon keeps them.
 */
export class PortLeases {
  private leases: Record<string, number>;

  constructor(private readonly file: string) {
    this.leases = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, number>) : {};
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.leases, null, 2));
  }

  get(jobId: string): number | null {
    return this.leases[jobId] ?? null;
  }

  async lease(jobId: string, preferred?: number | null): Promise<number> {
    const existing = this.leases[jobId];
    if (existing) return existing;
    const taken = new Set(Object.values(this.leases));
    const candidates: number[] = [];
    if (preferred && !taken.has(preferred)) candidates.push(preferred);
    for (let i = 0; i < PORT_BLOCKS; i++) candidates.push(PORT_RANGE_START + i * PORT_BLOCK);
    for (const base of candidates) {
      if (taken.has(base)) continue;
      if (!(await portFree(base))) continue;
      this.leases[jobId] = base;
      this.save();
      return base;
    }
    throw new Error("no free port block for the job");
  }

  release(jobId: string): void {
    if (!(jobId in this.leases)) return;
    delete this.leases[jobId];
    this.save();
  }

  jobIds(): string[] {
    return Object.keys(this.leases);
  }
}
