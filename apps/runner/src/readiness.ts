import { exec, which } from "@foundry/os-adapters";
import { type Os, parseRecipeYaml, type Recipe } from "@foundry/shared";
import type { ControlPlane } from "./api";
import { runCommand } from "./checks";
import type { Workspace } from "./workspace";

export interface ReadinessResult {
  ready: boolean;
  reason: string | null;
}

/** `node>=20` → `node`; `postgres` stays `postgres`. */
export function depBinary(dep: string): string {
  return dep.split(/[<>=@\s]/)[0]!.trim();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function versionOf(bin: string): Promise<string | null> {
  const r = await runCommand(`${bin} --version`, { cwd: process.cwd(), env: {}, timeoutMs: 10_000 });
  return /(\d+\.\d+(?:\.\d+)?)/.exec(r.output)?.[1] ?? null;
}

/**
 * Can this runner run jobs for a repo (spec 5.6)? It checks the recipe's OS constraint and
 * `system_deps` (binaries on PATH, with an optional minimum version).
 */
export async function checkRecipe(
  recipe: Recipe,
  os: Os,
  opts: { postgresUrl?: string; which?: (bin: string) => Promise<boolean> } = {},
): Promise<ReadinessResult> {
  if (recipe.os && !recipe.os.includes(os)) return { ready: false, reason: `recipe is limited to ${recipe.os.join(", ")}` };
  const find = opts.which ?? ((bin: string) => which(exec, bin));
  const missing: string[] = [];
  for (const dep of recipe.system_deps) {
    const bin = depBinary(dep);
    if (!(await find(bin))) {
      missing.push(dep);
      continue;
    }
    const min = />=\s*(\d+(?:\.\d+)*)/.exec(dep)?.[1];
    if (min && !opts.which) {
      const v = await versionOf(bin);
      if (v && compareVersions(v, min) < 0) missing.push(`${dep} (found ${v})`);
    }
  }
  if (missing.length) return { ready: false, reason: `missing: ${missing.join(", ")}` };
  if (recipe.services.postgres && !opts.postgresUrl) {
    return { ready: false, reason: "recipe needs Postgres; set postgresUrl in the runner config" };
  }
  return { ready: true, reason: null };
}

/** Re-check every repo whose recipe changed since the last report and tell the control plane. */
export class ReadinessReporter {
  private readonly reported = new Map<string, string | null>();

  constructor(
    private readonly api: ControlPlane,
    private readonly workspace: Workspace,
    private readonly os: Os,
    private readonly opts: { postgresUrl?: string; log: (m: string) => void },
  ) {}

  async sync(repos: { id: string; fullName: string; defaultBranch: string; recipeSha: string | null }[]): Promise<void> {
    for (const repo of repos) {
      if (!repo.recipeSha || this.reported.get(repo.id) === repo.recipeSha) continue;
      let result: ReadinessResult;
      try {
        const token = (await this.api.gitToken(repo.id)).token;
        const mirror = await this.workspace.ensureMirror(repo.fullName, token);
        const file = await this.workspace.readFileAt(mirror, `origin/${repo.defaultBranch}`, ".foundry/recipe.yaml");
        result = file
          ? await checkRecipe(parseRecipeYaml(file.content), this.os, this.opts)
          : { ready: false, reason: "recipe not found on the default branch" };
      } catch (err) {
        result = { ready: false, reason: `readiness check failed: ${String(err).slice(0, 300)}` };
      }
      await this.api.readiness({ repoId: repo.id, recipeSha: repo.recipeSha, ...result });
      this.reported.set(repo.id, repo.recipeSha);
      this.opts.log(`readiness ${repo.fullName}: ${result.ready ? "ready" : result.reason}`);
    }
  }
}
