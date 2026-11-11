import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactUrl,
  ConflictError,
  type ControlContext,
  claimJob,
  completeOnboarding,
  createJoinToken,
  heartbeat,
  joinRunner,
  openPullRequest,
  ownedJob,
  processWebhook,
  reportReadiness,
  runnerAsk,
  runnerCheckpoint,
  runnerConfidence,
  runnerEvents,
  runnerEvidence,
  runnerGitToken,
  runnerInputs,
  runnerPlan,
  runnerPrReview,
  runnerStage,
  storeArtifact,
  storeWebhook,
} from "@foundry/control";
import { createTestEnv, type TestEnv } from "@foundry/control/testing";
import { memberships, repos, runners, teams, users } from "@foundry/db";
import { FakeGitHub, type GhPrFile, type RepoRef } from "@foundry/github";
import type { HarnessAdapter } from "@foundry/harness-core";
import type { OsAdapter } from "@foundry/os-adapters";
import { type ControlPlane, Daemon, JobRevokedError } from "@foundry/runner";
import {
  InvalidTransitionError,
  LAPTOP_DEFAULT_SCHEDULE,
  type LocalSchedule,
  noopLogger,
} from "@foundry/shared";
import { eq } from "drizzle-orm";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  })
    .toString()
    .trim();
}

/**
 * FakeGitHub whose code lives in real bare repos (the runner pushes there through
 * FOUNDRY_GIT_BASE): PR head SHAs, changed files and `.foundry/` config come from git.
 */
export class GitBackedGitHub extends FakeGitHub {
  constructor(readonly gitRoot: string) {
    super();
  }

  bare(fullName: string): string {
    return join(this.gitRoot, `${fullName}.git`);
  }

  seed(fullName: string, files: Record<string, string>): void {
    const bare = this.bare(fullName);
    execFileSync("mkdir", ["-p", bare]);
    git(bare, "init", "--bare", "--quiet", "-b", "main");
    const work = mkdtempSync(join(tmpdir(), "foundry-seed-"));
    git(work, "init", "--quiet", "-b", "main");
    for (const [path, content] of Object.entries(files)) {
      execFileSync("mkdir", ["-p", join(work, path, "..")]);
      execFileSync("sh", ["-c", 'cat > "$1"', "sh", join(work, path)], { input: content });
    }
    git(work, "add", "-A");
    git(work, "commit", "--quiet", "-m", "init");
    git(work, "push", "--quiet", bare, "main");
  }

  private sha(fullName: string, branch: string): string | null {
    try {
      return git(this.bare(fullName), "rev-parse", `refs/heads/${branch}`);
    } catch {
      return null;
    }
  }

  override async getFile(ref: RepoRef, path: string) {
    try {
      const sha = git(this.bare(ref.fullName), "rev-parse", `main:${path}`);
      return { content: git(this.bare(ref.fullName), "cat-file", "blob", sha), sha };
    } catch {
      return null;
    }
  }

  override async getBranchSha(ref: RepoRef, branch: string) {
    return this.sha(ref.fullName, branch);
  }

  private refresh(ref: RepoRef, number: number): void {
    const r = this.repo(ref.fullName);
    const pr = r.prs.get(number);
    if (!pr) return;
    const head = this.sha(ref.fullName, pr.head);
    if (head) pr.headSha = head;
    const bare = this.bare(ref.fullName);
    const files: GhPrFile[] = git(bare, "diff", "--numstat", `main...${pr.head}`)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [add, del, filename] = line.split("\t");
        const patch = git(bare, "diff", `main...${pr.head}`, "--", filename!);
        return { filename: filename!, additions: Number(add), deletions: Number(del), patch };
      });
    r.prFiles.set(number, files);
  }

  override async createPullRequest(
    ref: RepoRef,
    input: { head: string; base: string; title: string; body: string },
  ) {
    const pr = await super.createPullRequest(ref, input);
    this.refresh(ref, pr.number);
    return this.getPullRequest(ref, pr.number);
  }

  override async getPullRequest(ref: RepoRef, number: number) {
    this.refresh(ref, number);
    return super.getPullRequest(ref, number);
  }
}

function revoked<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof ConflictError || err instanceof InvalidTransitionError)
      throw new JobRevokedError(String(err.message));
    throw err;
  });
}

/** The runner's ControlPlane wired straight into `@foundry/control`, as the HTTP routes do. */
export class DirectControlPlane implements ControlPlane {
  constructor(
    private readonly ctx: ControlContext,
    readonly runnerId: string,
  ) {}

  private async runner() {
    const r = await this.ctx.db.query.runners.findFirst({ where: eq(runners.id, this.runnerId) });
    if (!r) throw new Error("runner gone");
    return r;
  }

  async heartbeat(req: Parameters<ControlPlane["heartbeat"]>[0]) {
    return heartbeat(this.ctx, await this.runner(), req);
  }
  async claim() {
    return claimJob(this.ctx, await this.runner());
  }
  async readiness(req: Parameters<ControlPlane["readiness"]>[0]) {
    await reportReadiness(this.ctx, await this.runner(), req);
  }
  async gitToken(repoId: string) {
    return runnerGitToken(this.ctx, await this.runner(), repoId);
  }
  async uploadArtifact(jobId: string, name: string, contentType: string, bytes: Uint8Array) {
    return revoked(async () => {
      const job = await ownedJob(this.ctx, await this.runner(), jobId);
      const row = await storeArtifact(this.ctx, { teamId: job.teamId, jobId, name, contentType, bytes });
      return { artifactId: row.id, url: artifactUrl(this.ctx, row.id) };
    });
  }
  async events(jobId: string, events: Parameters<ControlPlane["events"]>[1]) {
    await revoked(async () => runnerEvents(this.ctx, await this.runner(), jobId, events));
  }
  async stage(jobId: string, req: Parameters<ControlPlane["stage"]>[1]) {
    return revoked(async () => {
      const job = await runnerStage(this.ctx, await this.runner(), jobId, req);
      if (!job) throw new JobRevokedError("job moved");
      return { status: job.status };
    });
  }
  async ask(jobId: string, prompt: string, options: string[]) {
    return revoked(async () => ({
      questionId: (await runnerAsk(this.ctx, await this.runner(), jobId, prompt, options)).id,
    }));
  }
  async evidence(jobId: string, req: Parameters<ControlPlane["evidence"]>[1]) {
    return revoked(async () => ({
      id: (await runnerEvidence(this.ctx, await this.runner(), jobId, req)).id,
    }));
  }
  async confidence(jobId: string, req: Parameters<ControlPlane["confidence"]>[1]) {
    await revoked(async () => runnerConfidence(this.ctx, await this.runner(), jobId, req));
  }
  async plan(jobId: string, plan: string) {
    await revoked(async () => runnerPlan(this.ctx, await this.runner(), jobId, plan));
  }
  async checkpoint(jobId: string, req: Parameters<ControlPlane["checkpoint"]>[1]) {
    await revoked(async () => runnerCheckpoint(this.ctx, await this.runner(), jobId, req));
  }
  async openPr(jobId: string, req: Parameters<ControlPlane["openPr"]>[1]) {
    return revoked(async () =>
      openPullRequest(this.ctx, await ownedJob(this.ctx, await this.runner(), jobId), req),
    );
  }
  async onboarding(jobId: string, result: Parameters<ControlPlane["onboarding"]>[1]) {
    await revoked(async () => {
      await completeOnboarding(this.ctx, await ownedJob(this.ctx, await this.runner(), jobId), result);
    });
  }
  async inputs(jobId: string) {
    return revoked(async () => runnerInputs(this.ctx, await this.runner(), jobId, true)) as Promise<
      Awaited<ReturnType<ControlPlane["inputs"]>>
    >;
  }
  async submitPrReview(jobId: string, report: Parameters<ControlPlane["submitPrReview"]>[1]) {
    return revoked(async () => runnerPrReview(this.ctx, await this.runner(), jobId, report));
  }
}

export function fakeOs(os: "macos" | "linux", power: { ac: boolean | null } = { ac: null }): OsAdapter {
  return {
    os,
    info: async () => ({
      os,
      osVersion: os === "macos" ? "15.1" : "Ubuntu 24.04",
      arch: "arm64",
      cpu: 8,
      memMb: 16_000,
    }),
    diskFreeMb: async () => 100_000,
    onAcPower: async () => power.ac,
    idleSeconds: async () => null,
    inhibitSleep: async () => ({ release: () => {} }),
    service: () => ({ path: "", contents: "", activate: [], deactivate: [] }),
    createUserCommands: () => [],
    secrets: async () => {
      throw new Error("unused in e2e");
    },
    wrapWithLimits: async (argv) => argv,
  };
}

export interface E2E extends TestEnv {
  gh: GitBackedGitHub;
  team: { id: string };
  alice: { id: string };
  repo: { id: string };
  daemons: Daemon[];
  /** Join a runner the real way (join token) and start its daemon. */
  startRunner(opts: {
    name: string;
    os: "macos" | "linux";
    kind?: "shared" | "personal";
    harness: HarnessAdapter;
    schedule?: LocalSchedule;
  }): Promise<{ daemon: Daemon; runnerId: string }>;
  deliver(event: string, payload: unknown): Promise<void>;
  job(): Promise<NonNullable<Awaited<ReturnType<ControlContext["db"]["query"]["jobs"]["findFirst"]>>>>;
  close(): Promise<void>;
}

let socketSeq = 0;

/** A real control plane on a throwaway database, a git-backed GitHub, and runner daemons. */
export async function createE2E(opts: { recipe: string; policy?: string; mergeMode?: string }): Promise<E2E> {
  const gitRoot = mkdtempSync(join(tmpdir(), "foundry-e2e-git-"));
  process.env.FOUNDRY_GIT_BASE = `file://${gitRoot}`;
  process.env.ARTIFACTS_DIR = mkdtempSync(join(tmpdir(), "foundry-e2e-art-"));
  const base = await createTestEnv();
  const gh = new GitBackedGitHub(gitRoot);
  base.ctx.gh = gh;
  const files: Record<string, string> = { ".foundry/recipe.yaml": opts.recipe, "README.md": "# app\n" };
  if (opts.policy) files[".foundry/policy.yaml"] = opts.policy;
  gh.seed("acme/app", files);

  const { ctx } = base;
  const [team] = await ctx.db.insert(teams).values({ name: "acme" }).returning();
  const [alice] = await ctx.db
    .insert(users)
    .values({ ghLogin: "alice", email: "alice@acme.test" })
    .returning();
  const [bob] = await ctx.db.insert(users).values({ ghLogin: "bob", email: "bob@acme.test" }).returning();
  await ctx.db.insert(memberships).values([
    { teamId: team!.id, userId: alice!.id, role: "admin" },
    { teamId: team!.id, userId: bob!.id, role: "member" },
  ]);
  const recipe = await gh.getFile({ installationId: 1, fullName: "acme/app" }, ".foundry/recipe.yaml");
  const [repo] = await ctx.db
    .insert(repos)
    .values({
      teamId: team!.id,
      ghInstallationId: 1,
      ghRepoId: 4242,
      fullName: "acme/app",
      acceptsJobs: true,
      recipeSha: recipe!.sha,
      recipeYaml: opts.recipe,
      policyYaml: opts.policy ?? null,
      mergeMode: opts.mergeMode ?? "off",
    })
    .returning();

  const daemons: Daemon[] = [];
  const e2e: E2E = {
    ...base,
    gh,
    team: team!,
    alice: alice!,
    repo: repo!,
    daemons,
    async startRunner(r) {
      const token = createJoinToken(ctx, team!.id, alice!.id);
      const joined = await joinRunner(ctx, {
        joinToken: token,
        name: r.name,
        kind: r.kind ?? "personal",
        os: r.os,
        arch: "arm64",
        osVersion: "x",
        cpu: 8,
        memMb: 16_000,
        maxConcurrency: 1,
      });
      const daemon = new Daemon({
        api: new DirectControlPlane(ctx, joined.runnerId),
        os: fakeOs(r.os, { ac: r.os === "macos" ? true : null }),
        harnesses: { [r.harness.id]: r.harness },
        dataDir: mkdtempSync(join(tmpdir(), `foundry-e2e-${r.name}-`)),
        maxConcurrency: 1,
        schedule: r.schedule ?? LAPTOP_DEFAULT_SCHEDULE,
        minFreeDiskMb: 1_000,
        mcpCommand: { command: "foundry", args: ["mcp"] },
        socketPath: `/tmp/fdr-e2e-${process.pid}-${socketSeq++}.sock`,
        heartbeatMs: 3_600_000,
        logger: noopLogger,
      });
      await daemon.start();
      daemons.push(daemon);
      return { daemon, runnerId: joined.runnerId };
    },
    async deliver(event, payload) {
      const id = await storeWebhook(ctx, crypto.randomUUID(), event, payload);
      if (id !== null) await processWebhook(ctx, id);
    },
    async job() {
      const j = await ctx.db.query.jobs.findFirst();
      if (!j) throw new Error("no job");
      return j;
    },
    async close() {
      await Promise.all(daemons.map((d) => d.stop().catch(() => {})));
      await base.drop();
    },
  };
  return e2e;
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  what: string,
  ms = 20_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function labeledIssue(number: number, title: string, labels: string[] = ["foundry"]) {
  return {
    action: "labeled",
    label: { name: "foundry" },
    installation: { id: 1 },
    repository: { id: 4242, full_name: "acme/app", default_branch: "main" },
    sender: { login: "alice", type: "User" },
    issue: {
      number,
      title,
      body: "### Goal\n\nWrite done.txt\n\n### Acceptance criteria\n\ndone.txt exists",
      user: { login: "alice" },
      labels: labels.map((name) => ({ name })),
    },
  };
}

export function checkSuiteCompleted(sha: string) {
  return {
    action: "completed",
    installation: { id: 1 },
    repository: { id: 4242, full_name: "acme/app", default_branch: "main" },
    check_suite: { head_sha: sha },
  };
}
