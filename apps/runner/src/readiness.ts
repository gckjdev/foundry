import { exec, which } from "@foundry/os-adapters";
import { errorFields, type Logger, type Os, parseRecipeYaml, type Recipe } from "@foundry/shared";
import { httpProxyEnv } from "@foundry/shared/proxy";
import type { ControlPlane } from "./api";
import { type CommandResult, runCommand, tail } from "./checks";
import { RECIPE_FILE } from "./repo-files";
import { scrub, secretEnvValues } from "./scrub";
import type { Workspace } from "./workspace";

export interface ReadinessResult {
  ready: boolean;
  reason: string | null;
}

/** No readiness pass may hold the daemon longer than this, however wedged a command gets. */
export const READINESS_TIMEOUT_MS = 20 * 60_000;

const REASON_MAX = 300;
const TAIL_CHARS = 200;

interface ReadinessRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  recipeSha: string | null;
}

interface RecipeStep {
  name: string;
  run: string;
  /** No per-step budget for warm/install; the overall deadline bounds them. */
  timeoutMs?: number;
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
 * `system_deps` (binaries on PATH, with an optional minimum version). Cheap on purpose: it runs
 * before anything that touches the mirror or a worktree.
 */
export async function checkRecipe(
  recipe: Recipe,
  os: Os,
  opts: { postgresUrl?: string; which?: (bin: string) => Promise<boolean> } = {},
): Promise<ReadinessResult> {
  if (recipe.os && !recipe.os.includes(os))
    return { ready: false, reason: `recipe is limited to ${recipe.os.join(", ")}` };
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

/** Warm, install, then checks — the order a job would use (spec 5.4). */
function recipeSteps(recipe: Recipe): RecipeStep[] {
  const steps: RecipeStep[] = recipe.warm.map((run, i) => ({
    name: recipe.warm.length === 1 ? "warm" : `warm ${i + 1}`,
    run,
  }));
  if (recipe.install) steps.push({ name: "install", run: recipe.install });
  for (const check of recipe.checks)
    steps.push({ name: check.name, run: check.run, timeoutMs: check.timeout_sec * 1000 });
  return steps;
}

function failureReason(
  step: RecipeStep,
  result: CommandResult,
  timeoutMs: number,
  secrets: string[],
): string {
  const how = result.timedOut
    ? `timed out after ${Math.round(timeoutMs / 1_000)}s`
    : `exit ${result.exitCode}`;
  const detail = scrub(tail(result.output.trim(), TAIL_CHARS), secrets);
  return `${step.name} failed (${how}): ${detail}`.slice(0, REASON_MAX);
}

/** Run every recipe step in `cwd`, stopping at the first failure or when the deadline passes. */
async function runRecipeSteps(opts: {
  recipe: Recipe;
  repo: string;
  cwd: string;
  env: Record<string, string>;
  secrets: string[];
  wrap?: string[];
  deadline: number;
  logger: Logger;
}): Promise<ReadinessResult> {
  const steps = recipeSteps(opts.recipe);
  for (const [index, step] of steps.entries()) {
    const remaining = opts.deadline - Date.now();
    if (remaining <= 0) {
      return {
        ready: false,
        reason: `${step.name} failed: readiness checks exceeded ${READINESS_TIMEOUT_MS / 60_000} minutes`,
      };
    }
    const timeoutMs = Math.min(step.timeoutMs ?? remaining, remaining);
    // Readiness can run the whole recipe, so the log says which step is running while it does.
    opts.logger.info("readiness step started", {
      repo: opts.repo,
      step: step.name,
      stepIndex: index + 1,
      stepCount: steps.length,
    });
    const result = await runCommand(step.run, {
      cwd: opts.cwd,
      env: opts.env,
      timeoutMs,
      wrap: opts.wrap,
    });
    if (result.exitCode !== 0) {
      opts.logger.warn("readiness step failed", {
        repo: opts.repo,
        step: step.name,
        durationMs: result.durationMs,
        ...(result.timedOut ? { timedOut: true } : { exitCode: result.exitCode }),
      });
      return { ready: false, reason: failureReason(step, result, timeoutMs, opts.secrets) };
    }
    opts.logger.info("readiness step passed", {
      repo: opts.repo,
      step: step.name,
      durationMs: result.durationMs,
    });
  }
  return { ready: true, reason: null };
}

function readinessEnv(postgresUrl?: string): Record<string, string> {
  const env = httpProxyEnv();
  // Let checks that need a database use the runner's Postgres, as CI does.
  if (postgresUrl) env.FOUNDRY_TEST_DATABASE_URL = postgresUrl;
  return env;
}

function readinessWorktreeId(repoId: string): string {
  return `readiness-${repoId.replace(/[^\w.-]+/g, "__")}`;
}

/**
 * Re-check every repo whose recipe changed since the last report and tell the control plane.
 * A pass clones the default branch into a temporary worktree and really runs the recipe, so a
 * "ready" runner has proven the recipe on its machine (spec 5.4).
 */
export class ReadinessReporter {
  private readonly reported = new Map<string, string | null>();
  private checking = false;

  constructor(
    private readonly api: ControlPlane,
    private readonly workspace: Workspace,
    private readonly os: Os,
    private readonly opts: {
      postgresUrl?: string;
      logger: Logger;
      /** Daemon resource-limit prefix; a getter because `start()` sets it after construction. */
      wrap?: () => string[] | undefined;
    },
  ) {}

  async sync(repos: ReadinessRepo[]): Promise<void> {
    // A pass can take minutes while heartbeats keep firing. Later ticks still report the
    // heartbeat and claim jobs, but must not start a second pass.
    if (this.checking) return;
    this.checking = true;
    try {
      for (const repo of repos) {
        if (!repo.recipeSha || this.reported.get(repo.id) === repo.recipeSha) continue;
        const startedAt = Date.now();
        this.opts.logger.info("readiness check started", { repo: repo.fullName });
        const result = await this.check(repo);
        await this.api.readiness({ repoId: repo.id, recipeSha: repo.recipeSha, ...result });
        this.reported.set(repo.id, repo.recipeSha);
        const durationMs = Date.now() - startedAt;
        if (result.ready) this.opts.logger.info("repo readiness passed", { repo: repo.fullName, durationMs });
        else
          this.opts.logger.warn("repo readiness failed", {
            repo: repo.fullName,
            reason: result.reason,
            durationMs,
          });
      }
    } finally {
      this.checking = false;
    }
  }

  private async check(repo: ReadinessRepo): Promise<ReadinessResult> {
    try {
      const token = (await this.api.gitToken(repo.id)).token;
      const mirrorStarted = Date.now();
      // The fetch is the one network step in readiness; log it so a stalled proxy is visible.
      this.opts.logger.info("readiness mirror fetch started", { repo: repo.fullName });
      const mirror = await this.workspace.ensureMirror(repo.fullName, token);
      this.opts.logger.info("readiness mirror ready", {
        repo: repo.fullName,
        durationMs: Date.now() - mirrorStarted,
      });
      const file = await this.workspace.readFileAt(mirror, `origin/${repo.defaultBranch}`, RECIPE_FILE);
      if (!file) return { ready: false, reason: "recipe not found on the default branch" };
      const recipe = parseRecipeYaml(file.content);
      const cheap = await checkRecipe(recipe, this.os, this.opts);
      if (!cheap.ready) return cheap;
      return await this.runInWorktree(repo, recipe, token, mirror);
    } catch (err) {
      return { ready: false, reason: `readiness check failed: ${String(err).slice(0, REASON_MAX)}` };
    }
  }

  private async runInWorktree(
    repo: ReadinessRepo,
    recipe: Recipe,
    token: string,
    mirror: string,
  ): Promise<ReadinessResult> {
    const id = readinessWorktreeId(repo.id);
    const worktreeStarted = Date.now();
    const cwd = await this.workspace.createDetachedWorktree({
      fullName: repo.fullName,
      branch: repo.defaultBranch,
      id,
      token,
      // The mirror was just fetched for the recipe; do not fetch it again.
      mirror,
    });
    this.opts.logger.info("readiness worktree ready", {
      repo: repo.fullName,
      durationMs: Date.now() - worktreeStarted,
    });
    try {
      const env = readinessEnv(this.opts.postgresUrl);
      return await runRecipeSteps({
        recipe,
        repo: repo.fullName,
        cwd,
        env,
        secrets: secretEnvValues({ ...process.env, ...env }),
        wrap: this.opts.wrap?.(),
        deadline: Date.now() + READINESS_TIMEOUT_MS,
        logger: this.opts.logger,
      });
    } finally {
      await this.workspace.removeWorktree(repo.fullName, id).catch((err) => {
        this.opts.logger.warn("readiness worktree removal failed", {
          repo: repo.fullName,
          ...errorFields(err),
        });
      });
    }
  }
}
