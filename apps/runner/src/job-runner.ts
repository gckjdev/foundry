import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import {
  appendHarnessLog,
  type HarnessAdapter,
  type HarnessEvent,
  type HarnessSession,
  harnessLogJson,
  type McpServerConfig,
  permissionsFromPolicy,
  type SessionResult,
} from "@foundry/harness-core";
import type { FoundryToolName, ToolReply } from "@foundry/mcp-foundry";
import {
  assemblePrompt,
  NUDGE_MESSAGE,
  renderInputs,
  resumeMessage,
  verifyFailedMessage,
} from "@foundry/playbooks";
import {
  briefRef,
  type ClaimedJob,
  DEFAULT_POLICY,
  expandRecipeVars,
  type FoundryEvent,
  type HandoffBrief,
  isUiChange,
  type PendingInput,
  type Policy,
  parseUnifiedDiff,
  type Recipe,
  RUNNER_STAGES,
  type RunnerStage,
} from "@foundry/shared";
import { httpProxyEnv } from "@foundry/shared/proxy";
import { type ControlPlane, JobRevokedError } from "./api";
import { fetchBrief, pushBrief } from "./brief";
import { type RunningCommand, runCommand, startCommand, tail } from "./checks";
import { gitOut } from "./git";
import type { PortLeases } from "./ports";
import { loadPlaybookFiles, loadPolicy, loadRecipe } from "./repo-files";
import { scrub, secretEnvValues } from "./scrub";
import { dropServices, provisionServices } from "./services";
import type { LocalJobs } from "./state";
import type { ToolServer } from "./tool-server";
import type { Workspace } from "./workspace";

export interface JobRunnerDeps {
  api: ControlPlane;
  harnesses: Partial<Record<string, HarnessAdapter>>;
  workspace: Workspace;
  ports: PortLeases;
  tools: ToolServer;
  localJobs: LocalJobs;
  /** How harnesses start the per-job `foundry` MCP server (normally `foundry mcp`). */
  mcpCommand: { command: string; args: string[] };
  log: (message: string, data?: Record<string, unknown>) => void;
  /** Extra env for every job (API keys, PATH). */
  baseEnv?: Record<string, string>;
  /** Prefix for job commands, e.g. resource limits from the OS adapter. */
  wrap?: string[];
  postgresUrl?: string;
  eventFlushMs?: number;
  /** Seconds to wait after `ask` for the agent to end its turn before stopping it. */
  askGraceMs?: number;
  maxNudges?: number;
  /** Capture a screenshot of `url` into `path`. Defaults to `npx playwright screenshot`. */
  screenshot?: (url: string, path: string) => Promise<void>;
}

export type JobOutcome = "pr_opened" | "onboarded" | "needs_input" | "paused" | "failed" | "revoked";

type StopReason = { kind: "paused" } | { kind: "revoked" } | { kind: "budget"; reason: string };

class FailJob extends Error {}

interface CheckRun {
  name: string;
  command: string;
  status: "passed" | "failed";
  exitCode: number | null;
  output: string;
}

const STAGE_ORDER = [...RUNNER_STAGES, "done"] as const;

function nextStage(stage: RunnerStage): (typeof STAGE_ORDER)[number] {
  return STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1]!;
}

function previousStage(stage: RunnerStage): RunnerStage | null {
  const i = RUNNER_STAGES.indexOf(stage);
  return i > 0 ? RUNNER_STAGES[i - 1]! : null;
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Quote a value for a `sh -c` command line. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Drives one claimed job (spec 5.7–5.8): sets up the worktree, runs the harness through the
 * playbook stages, answers the agent's Foundry tool calls, runs the trusted recipe checks, and
 * either opens the PR, parks the job on a question, gives it back, or fails it.
 */
export class JobRunner {
  readonly jobId: string;
  private stage: RunnerStage;
  private lastCompleted: RunnerStage | null;
  private loop: number;
  private sessionCost = 0;
  private sessionId: string | null = null;
  private session: HarnessSession | null = null;
  private adapter!: HarnessAdapter;
  private cwd = "";
  private portBase = 0;
  private env: Record<string, string> = {};
  private recipe: Recipe | null = null;
  private policy: Policy = DEFAULT_POLICY;
  private gitToken: { token: string; expiresAt: number } | null = null;
  private buffer: FoundryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stopReason: StopReason | null = null;
  private asked = false;
  private doneSummary: string | null = null;
  private plan: string | null = null;
  private findings: string[] = [];
  private qa: { question: string; answer: string }[] = [];
  private uncertainties: string[] = [];
  private lastChecks: { tree: string; results: CheckRun[] } | null = null;
  private secrets: string[] = [];
  private keepWorktree = false;
  /** The agent already attached at least one screenshot via `evidence`. */
  private screenshotAttached = false;

  constructor(
    private readonly deps: JobRunnerDeps,
    readonly job: ClaimedJob,
  ) {
    this.jobId = job.id;
    this.stage = job.resumeStage;
    this.lastCompleted = previousStage(job.resumeStage);
    this.loop = job.loopCount;
    for (const i of job.pendingInputs)
      if (i.kind === "answer") this.qa.push({ question: i.questionPrompt ?? "", answer: i.text });
  }

  get currentStage(): RunnerStage {
    return this.stage;
  }

  /** Give the job back (schedule window closed, daemon shutting down). */
  async pause(): Promise<void> {
    await this.halt({ kind: "paused" });
  }

  /** The control plane took the job away (cancelled, re-assigned). */
  async revoke(): Promise<void> {
    await this.halt({ kind: "revoked" });
  }

  private async halt(reason: StopReason): Promise<void> {
    this.stopReason ??= reason;
    if (this.session) await this.adapter.stop(this.session).catch(() => {});
  }

  async run(): Promise<JobOutcome> {
    let outcome: JobOutcome;
    try {
      await this.setup();
      outcome = await this.drive();
    } catch (err) {
      outcome = await this.handleError(err);
    } finally {
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.deps.tools.unregister(this.jobId);
    }
    await this.cleanup(outcome);
    this.deps.log(`job ${this.jobId} finished: ${outcome}`);
    return outcome;
  }

  // ---- setup ---------------------------------------------------------------------------------

  private noteHarness(section: string, body: string): void {
    appendHarnessLog(this.deps.localJobs.harnessLog(this.jobId), section, body, (t) => this.scrub(t));
  }

  private async token(): Promise<string> {
    if (!this.gitToken || this.gitToken.expiresAt - Date.now() < 5 * 60_000) {
      const t = await this.deps.api.gitToken(this.job.repo.id);
      this.gitToken = { token: t.token, expiresAt: Date.parse(t.expiresAt) || Date.now() + 30 * 60_000 };
      this.secrets.push(t.token);
    }
    return this.gitToken.token;
  }

  private async setup(): Promise<void> {
    const { job, deps } = this;
    const adapter = deps.harnesses[job.harness];
    if (!adapter) throw new FailJob(`harness ${job.harness} is not available on this runner`);
    this.adapter = adapter;

    const local = deps.localJobs.get(job.id);
    const token = await this.token();
    if (job.resumeMode === "sticky" && local && existsSync(local.worktree)) {
      this.cwd = local.worktree;
      await deps.workspace.ensureMirror(job.repo.fullName, token);
    } else {
      this.cwd = await deps.workspace.createWorktree({
        fullName: job.repo.fullName,
        jobId: job.id,
        branch: job.branch,
        defaultBranch: job.repo.defaultBranch,
        token,
      });
    }
    this.portBase = await deps.ports.lease(job.id, local?.portBase);
    this.saveLocal("running");

    if (job.kind === "ticket") {
      const { recipe, error } = await loadRecipe(this.cwd);
      if (!recipe) throw new FailJob(error ?? "no recipe");
      this.recipe = recipe;
    } else {
      this.recipe = (await loadRecipe(this.cwd)).recipe;
    }
    this.policy = job.kind === "ticket" ? await loadPolicy(this.cwd) : DEFAULT_POLICY;

    const services =
      job.kind === "ticket" ? await provisionServices(job.id, this.recipe, deps.postgresUrl) : {};
    this.env = {
      ...httpProxyEnv(),
      ...deps.baseEnv,
      ...services,
      FOUNDRY_JOB_ID: job.id,
      FOUNDRY_PORT: String(this.portBase),
      FOUNDRY_PORT_END: String(this.portBase + 9),
      FOUNDRY_BRANCH: job.branch,
    };
    this.secrets.push(...secretEnvValues(this.env));
    this.deps.log("harness transcript", { file: this.deps.localJobs.harnessLog(job.id) });
    this.noteHarness(
      "JOB start",
      harnessLogJson({
        jobId: job.id,
        harness: job.harness,
        model: job.model,
        kind: job.kind,
        cwd: this.cwd,
      }),
    );
    if (this.recipe?.env_file) {
      const envPath = join(this.cwd, ".env");
      if (!(await deps.workspace.readWorktreeFile(this.cwd, ".env"))) {
        await copyFile(join(this.cwd, this.recipe.env_file), envPath).catch(() => {});
      }
    }

    this.flushTimer = setInterval(() => void this.flush().catch(() => {}), deps.eventFlushMs ?? 1_000);

    if (job.kind === "ticket" && this.recipe?.install && job.resumeMode !== "sticky") {
      this.log("info", `Installing: ${this.recipe.install}`);
      const r = await runCommand(this.recipe.install, {
        cwd: this.cwd,
        env: this.env,
        timeoutMs: 30 * 60_000,
        wrap: deps.wrap,
      });
      if (r.exitCode !== 0)
        throw new FailJob(`install failed (exit ${r.exitCode}): ${this.scrub(tail(r.output, 2000))}`);
    }
  }

  private saveLocal(state: "running" | "parked"): void {
    this.deps.localJobs.put({
      jobId: this.jobId,
      repoFullName: this.job.repo.fullName,
      worktree: this.cwd,
      sessionId: this.sessionId,
      portBase: this.portBase || null,
      state,
    });
  }

  // ---- the agent loop ------------------------------------------------------------------------

  private mcpServers(mcpToken: string): McpServerConfig[] {
    const env: Record<string, string> = {
      FOUNDRY_JOB_ID: this.jobId,
      FOUNDRY_MCP_TOKEN: mcpToken,
    };
    if (this.deps.tools.url) env.FOUNDRY_MCP_URL = this.deps.tools.url;
    else env.FOUNDRY_MCP_SOCKET = this.deps.tools.socketPath;
    return [
      {
        name: "foundry",
        command: this.deps.mcpCommand.command,
        args: this.deps.mcpCommand.args,
        env,
      },
    ];
  }

  private async startSession(): Promise<HarnessSession> {
    const { job } = this;
    const mcpToken = this.deps.tools.register(this.jobId, (tool, args) => this.onTool(tool, args));
    const mcpServers = this.mcpServers(mcpToken);
    const opts = {
      cwd: this.cwd,
      model: job.model ?? "",
      env: { ...this.env, ...mcpServers[0]!.env },
      mcpServers,
      permissions: permissionsFromPolicy(this.policy),
      harnessPort: this.portBase + 9,
      logFile: this.deps.localJobs.harnessLog(this.jobId),
      redact: (text: string) => this.scrub(text),
    };
    const files = await loadPlaybookFiles(this.cwd, [job.playbook, job.harness]);
    const brief =
      job.resumeMode === "portable" ? await fetchBrief(this.cwd, job.id, await this.token()) : null;
    if (brief) {
      this.plan = brief.plan;
      this.findings = [...brief.findings];
      this.qa = [...brief.qa, ...this.qa];
      this.uncertainties = [...brief.uncertainties];
    }
    const { systemPrompt, prompt } = assemblePrompt({
      job: {
        kind: job.kind,
        title: job.title,
        body: job.body,
        issueNumber: job.issueNumber,
        repoFullName: job.repo.fullName,
        playbook: job.playbook,
        harness: job.harness,
        author: job.author,
        branch: job.branch,
      },
      repo: files,
      brief,
      inputs: job.pendingInputs,
      resumeStage: this.stage,
    });

    let session: HarnessSession;
    if (job.resumeMode === "sticky" && job.sessionId) {
      this.sessionId = job.sessionId;
      const message = resumeMessage(job.pendingInputs, this.stage);
      this.noteHarness("REQUEST resume", `${systemPrompt}\n\n---\n\n${message}`);
      session = await this.adapter.resume(job.sessionId, message, { ...opts, systemPrompt });
    } else {
      this.noteHarness("REQUEST start", `${systemPrompt}\n\n---\n\n${prompt}`);
      session = await this.adapter.start({ ...opts, systemPrompt, prompt });
    }
    this.track(session);
    this.startOpts = { ...opts, systemPrompt };
    return session;
  }

  private startOpts: Parameters<HarnessAdapter["resume"]>[2] | null = null;

  private async resumeWith(message: string): Promise<HarnessSession> {
    const id = this.sessionId ?? (await this.session?.id);
    if (!id || !this.startOpts) throw new FailJob("cannot continue: the harness reported no session id");
    this.noteHarness("REQUEST resume", message);
    const session = await this.adapter.resume(id, message, this.startOpts);
    this.track(session);
    return session;
  }

  private track(session: HarnessSession): void {
    this.session = session;
    if (this.stopReason) void this.adapter.stop(session).catch(() => {});
    void session.id.then((id) => {
      this.sessionId = id;
      this.saveLocal("running");
    });
  }

  private async drive(): Promise<JobOutcome> {
    let session = await this.startSession();
    let nudges = 0;
    const deadline = setTimeout(
      () =>
        void this.halt({
          kind: "budget",
          reason: `job exceeded max_job_minutes (${this.policy.max_job_minutes})`,
        }),
      this.policy.max_job_minutes * 60_000,
    );
    try {
      for (;;) {
        const result = await this.consume(session);
        if (this.stopReason) return await this.onStopped(this.stopReason);
        if (this.asked) return await this.parkForAnswer();
        if (result.status === "error" && !this.doneSummary)
          throw new FailJob(`harness error: ${result.error ?? "unknown"}`);

        const inputs = await this.deps.api.inputs(this.jobId);
        if (inputs.length) {
          this.recordAnswers(inputs);
          session = await this.resumeWith(
            `${renderInputs(inputs)}\n\nTake this into account and continue with the playbook.`,
          );
          continue;
        }
        if (this.doneSummary !== null) {
          const next =
            this.job.kind === "onboarding" ? await this.finishOnboarding() : await this.finishTicket();
          if (typeof next !== "string") {
            session = await this.resumeWith(next.retry);
            continue;
          }
          return next;
        }
        if (nudges < (this.deps.maxNudges ?? 2)) {
          nudges++;
          this.log("info", "Agent stopped before finishing; nudging it to continue");
          session = await this.resumeWith(NUDGE_MESSAGE);
          continue;
        }
        throw new FailJob("the agent stopped before finishing the playbook");
      }
    } finally {
      clearTimeout(deadline);
    }
  }

  private recordAnswers(inputs: PendingInput[]): void {
    for (const i of inputs)
      if (i.kind === "answer") this.qa.push({ question: i.questionPrompt ?? "", answer: i.text });
  }

  /** Forward harness events until the turn ends; enforce the cost budget as usage arrives. */
  private async consume(session: HarnessSession): Promise<SessionResult> {
    for await (const e of session.events) {
      this.push(this.scrubEvent(e));
      if (e.kind === "usage") {
        this.sessionCost += e.costUsd;
        const total = this.job.costUsd + this.sessionCost;
        if (total > this.policy.max_cost_per_job_usd && !this.stopReason) {
          void this.halt({
            kind: "budget",
            reason: `job cost $${total.toFixed(2)} exceeded max_cost_per_job_usd ($${this.policy.max_cost_per_job_usd})`,
          });
        }
      }
    }
    const result = await session.done;
    this.noteHarness("RESPONSE session", harnessLogJson(result));
    await this.flush();
    return result;
  }

  // ---- tool calls from the agent ---------------------------------------------------------------

  private async onTool(tool: FoundryToolName, args: Record<string, unknown>): Promise<ToolReply> {
    try {
      this.noteHarness("MCP request", `${tool} ${harnessLogJson(args)}`);
      this.push({ kind: "tool_call", tool: `foundry.${tool}` });
      let reply: ToolReply;
      switch (tool) {
        case "stage":
          reply = await this.toolStage(String(args.name), String(args.summary ?? ""));
          break;
        case "plan":
          this.plan = String(args.plan);
          await this.flush();
          await this.deps.api.plan(this.jobId, this.plan);
          reply = { text: "Plan recorded." };
          break;
        case "ask":
          reply = await this.toolAsk(String(args.question), (args.options as string[] | undefined) ?? []);
          break;
        case "evidence":
          reply = await this.toolEvidence(args);
          break;
        case "run_checks":
          reply = await this.toolRunChecks((args.names as string[] | undefined) ?? undefined);
          break;
        case "confidence": {
          const req = {
            level: args.level as "high" | "medium" | "low",
            reasons: (args.reasons as string[] | undefined) ?? [],
            uncertainties: (args.uncertainties as string[] | undefined) ?? [],
          };
          this.uncertainties = req.uncertainties;
          await this.deps.api.confidence(this.jobId, req);
          reply = { text: `Confidence recorded: ${req.level}.` };
          break;
        }
        default:
          reply = { text: `Unknown tool ${tool}`, isError: true };
      }
      this.noteHarness("MCP reply", harnessLogJson(reply));
      return reply;
    } catch (err) {
      if (err instanceof JobRevokedError) void this.halt({ kind: "revoked" });
      const reply = { text: `Foundry could not record that: ${String(err)}`, isError: true as const };
      this.noteHarness("MCP error", harnessLogJson(reply));
      return reply;
    }
  }

  private async toolStage(name: string, summary: string): Promise<ToolReply> {
    const expected = nextStage(this.stage);
    if (name !== expected) {
      return {
        text:
          name === "done" && this.stage !== "verifying"
            ? `You are in ${this.stage}. Finish the stages in order: call stage(${expected}) first.`
            : `You are in ${this.stage}; the next stage is ${expected}, not ${name}.`,
        isError: true,
      };
    }
    if (summary) this.findings.push(`${this.stage}: ${summary}`);
    if (name === "done") {
      this.doneSummary = summary;
      return {
        text: "Recorded. End your turn now: the runner runs the recipe checks and opens the pull request.",
      };
    }
    const from = this.stage;
    await this.flush();
    await this.deps.api.stage(this.jobId, {
      to: name as RunnerStage,
      lastCompletedStage: from,
      sessionId: this.sessionId,
    });
    this.lastCompleted = from;
    this.stage = name as RunnerStage;
    await this.checkpoint();
    return { text: `Now in ${name}.` };
  }

  private async toolAsk(question: string, options: string[]): Promise<ToolReply> {
    if (this.asked)
      return { text: "You already asked a question. End your turn and wait for the answer.", isError: true };
    this.sessionId ??= await Promise.race([
      this.session?.id ?? Promise.resolve(null),
      new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
    ]);
    await this.checkpoint();
    await this.flush();
    await this.deps.api.ask(this.jobId, question, options);
    this.asked = true;
    const grace = this.deps.askGraceMs ?? 20_000;
    setTimeout(() => {
      if (this.session) void this.adapter.stop(this.session).catch(() => {});
    }, grace).unref?.();
    return {
      text: "Question posted to the ticket author. End your turn now; you will be resumed with the answer.",
    };
  }

  private async toolEvidence(args: Record<string, unknown>): Promise<ToolReply> {
    const kind = args.kind === "screenshot" ? "screenshot" : "note";
    const name = String(args.name);
    const status = (args.status as "passed" | "failed" | "skipped" | undefined) ?? "passed";
    if (kind === "note") {
      await this.deps.api.evidence(this.jobId, {
        kind,
        name,
        status,
        outputTail: args.detail ? this.scrub(String(args.detail)) : null,
      });
      return { text: "Note recorded." };
    }
    if (!args.path) return { text: "A screenshot needs `path`.", isError: true };
    const path = resolve(this.cwd, String(args.path));
    if (relative(this.cwd, path).startsWith(".."))
      return { text: "The screenshot must be inside the worktree.", isError: true };
    const type = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!type) return { text: "Screenshots must be PNG, JPEG or WebP.", isError: true };
    const bytes = new Uint8Array(await readFile(path));
    const art = await this.deps.api.uploadArtifact(this.jobId, `${name}${extname(path)}`, type, bytes);
    await this.deps.api.evidence(this.jobId, { kind, name, status, artifactId: art.artifactId });
    this.screenshotAttached = true;
    return { text: `Screenshot attached: ${art.url}` };
  }

  /**
   * Spec 5.3/5.5 rule 3: a UI-affecting diff needs a screenshot. When the agent did not attach
   * one, start the recipe's dev server and capture the app itself.
   */
  private async captureUiScreenshot(recipe: Recipe | null): Promise<void> {
    if (this.screenshotAttached) return;
    const dev = recipe?.dev_server;
    if (!dev) throw new FailJob("recipe has no dev_server; UI change needs a screenshot");
    const readyPath = dev.ready_path.startsWith("/") ? dev.ready_path : `/${dev.ready_path}`;
    const url = `http://127.0.0.1:${this.portBase}${readyPath}`;
    const command = expandRecipeVars(dev.run, this.env);
    this.log("info", `Starting dev server for screenshot: ${command}`);
    const server = startCommand(command, { cwd: this.cwd, env: this.env, wrap: this.deps.wrap });
    try {
      await this.waitForDevServer(url, server, dev.timeout_sec);
      const file = join(this.cwd, ".foundry-local", "verify.png");
      await mkdir(dirname(file), { recursive: true });
      const capture = this.deps.screenshot ?? ((u, p) => this.playwrightScreenshot(u, p));
      await capture(url, file);
      const reply = await this.toolEvidence({
        kind: "screenshot",
        name: "verify",
        status: "passed",
        path: relative(this.cwd, file),
      });
      if (reply.isError) throw new FailJob(reply.text);
    } finally {
      server.stop();
    }
  }

  private async waitForDevServer(url: string, server: RunningCommand, timeoutSec: number): Promise<void> {
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
      if (server.exitCode !== null)
        throw new FailJob(
          `dev server exited before it became ready (exit ${server.exitCode}): ${this.scrub(tail(server.output(), 2_000))}`,
        );
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        await res.body?.cancel();
        if (res.ok) return;
      } catch {}
      if (Date.now() >= deadline)
        throw new FailJob(
          `dev server was not ready at ${url} within ${timeoutSec}s: ${this.scrub(tail(server.output(), 2_000))}`,
        );
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private async playwrightScreenshot(url: string, path: string): Promise<void> {
    const r = await runCommand(
      `npx --yes playwright screenshot --wait-for-timeout 1000 ${shQuote(url)} ${shQuote(path)}`,
      { cwd: this.cwd, env: this.env, timeoutMs: 180_000, wrap: this.deps.wrap },
    );
    if (r.exitCode !== 0)
      throw new FailJob(
        `playwright not installed; add it to recipe.warm / system_deps (npx exit ${r.exitCode}: ${this.scrub(tail(r.output, 2_000))})`,
      );
  }

  private async currentRecipe(): Promise<{ recipe: Recipe | null; error: string | null }> {
    // Onboarding writes the recipe as it goes; ticket jobs keep the recipe they started with.
    if (this.job.kind === "onboarding") return loadRecipe(this.cwd);
    return { recipe: this.recipe, error: null };
  }

  private async treeFingerprint(): Promise<string> {
    await gitOut(["add", "-A"], { cwd: this.cwd });
    return gitOut(["write-tree"], { cwd: this.cwd });
  }

  /** Run recipe checks and record each as evidence. Only these results count for the gate. */
  private async runChecks(names?: string[]): Promise<CheckRun[]> {
    const { recipe, error } = await this.currentRecipe();
    if (!recipe) throw new FailJob(error ?? "no recipe");
    const checks = recipe.checks.filter((c) => !names?.length || names.includes(c.name));
    const tree = await this.treeFingerprint();
    const results: CheckRun[] = [];
    for (const check of checks) {
      const r = await runCommand(check.run, {
        cwd: this.cwd,
        env: this.env,
        timeoutMs: check.timeout_sec * 1000,
        wrap: this.deps.wrap,
      });
      const status = r.exitCode === 0 ? "passed" : "failed";
      const output = this.scrub(
        r.timedOut ? `${r.output}\n[timed out after ${check.timeout_sec}s]` : r.output,
      );
      results.push({ name: check.name, command: check.run, status, exitCode: r.exitCode, output });
      await this.deps.api.evidence(this.jobId, {
        kind: "check",
        name: check.name,
        status,
        command: check.run,
        exitCode: r.exitCode,
        outputTail: tail(output, 8_000),
        durationMs: r.durationMs,
      });
    }
    if (!names?.length) this.lastChecks = { tree, results };
    return results;
  }

  private async toolRunChecks(names?: string[]): Promise<ToolReply> {
    const results = await this.runChecks(names);
    if (results.length === 0) return { text: "The recipe defines no checks." };
    const lines = results.map((r) =>
      r.status === "passed"
        ? `✓ ${r.name}`
        : `✗ ${r.name} (exit ${r.exitCode})\n\`\`\`\n${tail(r.output, 3_000)}\n\`\`\``,
    );
    const failed = results.filter((r) => r.status === "failed").length;
    return {
      text: `${failed ? `${failed} of ${results.length} checks failed.` : "All checks passed."}\n\n${lines.join("\n\n")}`,
    };
  }

  // ---- finishing -----------------------------------------------------------------------------

  /** Trusted verify (spec 5.7): re-run checks unless the agent's last full run matches this tree. */
  private async verifiedChecks(): Promise<CheckRun[]> {
    const tree = await this.treeFingerprint();
    if (this.lastChecks && this.lastChecks.tree === tree) return this.lastChecks.results;
    return this.runChecks();
  }

  private async retryOrGiveUp(failures: CheckRun[]): Promise<{ retry: string } | null> {
    if (this.loop >= this.policy.max_verify_loops) return null;
    this.loop++;
    await this.flush();
    await this.deps.api.stage(this.jobId, {
      to: "implementing",
      reason: `verify loop ${this.loop}: checks failed`,
      loopCount: this.loop,
    });
    this.stage = "implementing";
    this.lastCompleted = "investigating";
    this.doneSummary = null;
    return {
      retry: verifyFailedMessage(
        failures.map((f) => ({ name: f.name, command: f.command, outputTail: f.output })),
        this.loop,
        this.policy.max_verify_loops,
      ),
    };
  }

  private async finishTicket(): Promise<JobOutcome | { retry: string }> {
    const results = await this.verifiedChecks();
    const failures = results.filter((r) => r.status === "failed");
    if (failures.length) {
      const retry = await this.retryOrGiveUp(failures);
      if (retry) return retry;
      throw new FailJob(
        `recipe checks still failing after ${this.loop} verify loops: ${failures
          .map((f) => f.name)
          .join(", ")}`,
      );
    }
    await this.deps.workspace.commitAll(
      this.cwd,
      `${this.job.title}${this.job.issueNumber ? ` (#${this.job.issueNumber})` : ""}`,
    );
    const diff = parseUnifiedDiff(
      await this.deps.workspace.diffAgainstBase(this.cwd, this.job.repo.defaultBranch),
    );
    if (diff.files.length === 0) throw new FailJob("the agent finished without changing any files");
    const uiChanged = isUiChange(diff, this.recipe?.ui_paths ?? []);
    if (uiChanged) await this.captureUiScreenshot(this.recipe);
    const token = await this.token();
    await this.deps.workspace.push(this.cwd, this.job.branch, token);
    const headSha = await this.deps.workspace.headSha(this.cwd);
    await this.flush();
    await this.deps.api.openPr(this.jobId, {
      title: this.job.title,
      summary: this.doneSummary ?? "",
      headSha,
      uiChanged,
      changedLines: diff.changedLines,
    });
    return "pr_opened";
  }

  private async finishOnboarding(): Promise<JobOutcome | { retry: string }> {
    const { recipe, error } = await loadRecipe(this.cwd);
    let failures: CheckRun[] = [];
    if (!recipe) {
      failures = [
        {
          name: "recipe",
          command: "parse .foundry/recipe.yaml",
          status: "failed",
          exitCode: null,
          output: error ?? "",
        },
      ];
    } else {
      if (recipe.install) {
        const r = await runCommand(recipe.install, {
          cwd: this.cwd,
          env: this.env,
          timeoutMs: 30 * 60_000,
          wrap: this.deps.wrap,
        });
        if (r.exitCode !== 0) {
          failures.push({
            name: "install",
            command: recipe.install,
            status: "failed",
            exitCode: r.exitCode,
            output: this.scrub(r.output),
          });
        }
      }
      if (!failures.length) {
        this.recipe = recipe;
        failures = (await this.verifiedChecks()).filter((r) => r.status === "failed");
        if (recipe.checks.length === 0) {
          failures.push({
            name: "checks",
            command: "recipe.checks",
            status: "failed",
            exitCode: null,
            output: "The recipe defines no checks.",
          });
        }
      }
    }
    if (failures.length) {
      const retry = await this.retryOrGiveUp(failures);
      if (retry) return retry;
      await this.flush();
      await this.deps.api.onboarding(this.jobId, {
        ok: false,
        reason: `recipe does not pass on this runner: ${failures.map((f) => f.name).join(", ")}`,
        headSha: null,
        summary: this.doneSummary ?? "",
      });
      return "failed";
    }
    if (!recipe) throw new FailJob(error ?? "no recipe");
    await this.deps.workspace.commitAll(this.cwd, "Set up Foundry");
    const diff = parseUnifiedDiff(
      await this.deps.workspace.diffAgainstBase(this.cwd, this.job.repo.defaultBranch),
    );
    if (isUiChange(diff, recipe.ui_paths)) await this.captureUiScreenshot(recipe);
    await this.deps.workspace.push(this.cwd, this.job.branch, await this.token());
    const headSha = await this.deps.workspace.headSha(this.cwd);
    await this.flush();
    await this.deps.api.onboarding(this.jobId, {
      ok: true,
      reason: null,
      headSha,
      summary: this.doneSummary ?? "",
    });
    return "onboarded";
  }

  // ---- checkpoints, pausing, failing -----------------------------------------------------------

  private brief(): HandoffBrief {
    return {
      version: 1,
      jobId: this.jobId,
      title: this.job.title,
      stageReached: this.lastCompleted ?? "none",
      harness: this.job.harness,
      sessionId: this.sessionId,
      plan: this.plan,
      findings: this.findings,
      checks: (this.lastChecks?.results ?? []).map((c) => ({ name: c.name, status: c.status })),
      qa: this.qa,
      uncertainties: this.uncertainties,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Commit and push work so far, push the handoff brief, record the checkpoint (spec 5.9). */
  private async checkpoint(): Promise<void> {
    let headSha: string | null = null;
    try {
      const token = await this.token();
      await this.deps.workspace.commitAll(
        this.cwd,
        `foundry: checkpoint after ${this.lastCompleted ?? "start"}`,
      );
      await this.deps.workspace.push(this.cwd, this.job.branch, token);
      headSha = await this.deps.workspace.headSha(this.cwd);
      await pushBrief(this.cwd, this.brief(), token);
    } catch (err) {
      if (err instanceof JobRevokedError) throw err;
      this.log("warn", `checkpoint push failed: ${this.scrub(String(err))}`);
    }
    await this.deps.api.checkpoint(this.jobId, {
      stage: this.lastCompleted,
      sessionId: this.sessionId,
      briefRef: briefRef(this.jobId),
      headSha,
    });
  }

  private async parkForAnswer(): Promise<JobOutcome> {
    this.keepWorktree = true;
    this.buffer = [];
    this.saveLocal("parked");
    return "needs_input";
  }

  private async onStopped(reason: StopReason): Promise<JobOutcome> {
    if (reason.kind === "revoked") return "revoked";
    if (reason.kind === "budget") throw new FailJob(reason.reason);
    await this.flush();
    await this.checkpoint();
    await this.deps.api.stage(this.jobId, {
      to: "queued",
      reason: "runner paused (schedule or shutdown)",
      lastCompletedStage: this.lastCompleted,
      sessionId: this.sessionId,
      worktreePath: this.cwd,
      portBase: this.portBase,
    });
    this.keepWorktree = true;
    this.saveLocal("parked");
    return "paused";
  }

  private async handleError(err: unknown): Promise<JobOutcome> {
    if (err instanceof JobRevokedError || this.stopReason?.kind === "revoked") return "revoked";
    const reason = err instanceof FailJob ? err.message : `runner error: ${String(err)}`;
    this.noteHarness("JOB failed", reason);
    this.deps.log(`job ${this.jobId} failed: ${reason}`);
    try {
      this.push({ kind: "error", message: this.scrub(reason) });
      await this.flush();
      await this.deps.api.stage(this.jobId, {
        to: "failed",
        reason: this.scrub(reason).slice(0, 2_000),
        loopCount: this.loop,
      });
    } catch (e) {
      if (e instanceof JobRevokedError) return "revoked";
      this.deps.log(`could not report failure: ${String(e)}`);
    }
    return "failed";
  }

  private async cleanup(outcome: JobOutcome): Promise<void> {
    if (this.cwd) await this.adapter?.release?.(this.cwd).catch(() => {});
    if (this.keepWorktree && (outcome === "needs_input" || outcome === "paused")) return;
    const { deps } = this;
    await deps.workspace.removeWorktree(this.job.repo.fullName, this.jobId).catch(() => {});
    deps.ports.release(this.jobId);
    deps.localJobs.delete(this.jobId);
    if (this.job.kind === "ticket")
      await dropServices(this.jobId, this.recipe, deps.postgresUrl).catch(() => {});
  }

  // ---- events --------------------------------------------------------------------------------

  private scrub(text: string): string {
    return scrub(text, this.secrets);
  }

  private scrubEvent(e: HarnessEvent): FoundryEvent {
    switch (e.kind) {
      case "message":
        return { ...e, text: this.scrub(e.text) };
      case "tool_call":
        return e.summary ? { ...e, summary: this.scrub(e.summary) } : e;
      case "log":
        return { ...e, message: this.scrub(e.message) };
      case "error":
        return { ...e, message: this.scrub(e.message) };
      default:
        return e;
    }
  }

  private push(e: FoundryEvent): void {
    this.buffer.push(e);
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.push({ kind: "log", level, message: this.scrub(message) });
  }

  private flushing: Promise<void> = Promise.resolve();

  private flush(): Promise<void> {
    this.flushing = this.flushing
      .catch(() => {})
      .then(async () => {
        if (!this.buffer.length || this.asked) {
          if (this.asked) this.buffer = [];
          return;
        }
        const batch = this.buffer.splice(0, this.buffer.length);
        try {
          await this.deps.api.events(this.jobId, batch);
        } catch (err) {
          if (err instanceof JobRevokedError) {
            void this.halt({ kind: "revoked" });
            return;
          }
          this.buffer.unshift(...batch);
          throw err;
        }
      });
    return this.flushing;
  }
}
