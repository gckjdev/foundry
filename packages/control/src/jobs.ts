import { randomUUID } from "node:crypto";
import { events, type Job, jobInputs, jobs, repos, teams, users } from "@foundry/db";
import type { GhIssue } from "@foundry/github";
import {
  assertTransition,
  type FoundryEvent,
  isRunnerStage,
  type JobStatus,
  jobBranchName,
  type PendingInput,
  parseLabels,
  type RunnerStage,
  TERMINAL_STATUSES,
  TRIGGER_LABEL,
} from "@foundry/shared";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { bestEffort, type ControlContext } from "./context";
import { repoRef, syncJobToGitHub } from "./github-sync";

export class NotFoundError extends Error {}

export async function getJob(ctx: ControlContext, jobId: string): Promise<Job> {
  const job = await ctx.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new NotFoundError(`job ${jobId} not found`);
  return job;
}

/** Set (or, with `null`, clear) a job's own wall-clock limit in minutes. */
export async function setJobMaxMinutes(
  ctx: ControlContext,
  teamId: string,
  jobId: string,
  maxJobMinutes: number | null,
): Promise<Job> {
  if (maxJobMinutes !== null && (!Number.isInteger(maxJobMinutes) || maxJobMinutes < 1)) {
    throw new RangeError("max execution time must be a positive whole number of minutes");
  }
  const [row] = await ctx.db
    .update(jobs)
    .set({ maxJobMinutes, updatedAt: ctx.now() })
    .where(and(eq(jobs.id, jobId), eq(jobs.teamId, teamId)))
    .returning();
  if (!row) throw new NotFoundError(`job ${jobId} not found`);
  return row;
}

/** Set (or, with `null`, clear) a job's own max cost in US dollars. */
export async function setJobMaxCost(
  ctx: ControlContext,
  teamId: string,
  jobId: string,
  maxCostUsd: number | null,
): Promise<Job> {
  if (maxCostUsd !== null && (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0)) {
    throw new RangeError("max cost must be a positive number of US dollars");
  }
  const [row] = await ctx.db
    .update(jobs)
    .set({ maxCostUsd, updatedAt: ctx.now() })
    .where(and(eq(jobs.id, jobId), eq(jobs.teamId, teamId)))
    .returning();
  if (!row) throw new NotFoundError(`job ${jobId} not found`);
  return row;
}

export async function recordEvents(
  ctx: ControlContext,
  job: Pick<Job, "id" | "teamId" | "status">,
  list: FoundryEvent[],
): Promise<void> {
  if (list.length === 0) return;
  await ctx.db
    .insert(events)
    .values(
      list.map((e) => ({ jobId: job.id, teamId: job.teamId, kind: e.kind, stage: job.status, payload: e })),
    );
  let cost = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  for (const e of list) {
    if (e.kind !== "usage") continue;
    cost += e.costUsd;
    tokensIn += e.tokensIn;
    tokensOut += e.tokensOut;
  }
  if (cost > 0 || tokensIn > 0 || tokensOut > 0) {
    await ctx.db
      .update(jobs)
      .set({
        costUsd: sql`${jobs.costUsd} + ${cost}`,
        tokensIn: sql`${jobs.tokensIn} + ${tokensIn}`,
        tokensOut: sql`${jobs.tokensOut} + ${tokensOut}`,
      })
      .where(eq(jobs.id, job.id));
  }
}

export type JobPatch = Partial<Omit<typeof jobs.$inferInsert, "id" | "teamId" | "repoId" | "status">>;

export interface TransitionOptions {
  reason?: string;
  patch?: JobPatch;
  /** Only transition when the job is currently in one of these statuses. */
  from?: readonly JobStatus[];
}

/**
 * Move a job through the state machine (spec 5.3): validates the edge, applies the patch, writes
 * a `stage_changed` event and then syncs the GitHub status comment and labels.
 * Returns null when `from` did not match (someone else moved the job first).
 */
export async function transitionJob(
  ctx: ControlContext,
  jobId: string,
  to: JobStatus,
  opts: TransitionOptions = {},
): Promise<Job | null> {
  const result = await ctx.db.transaction(async (tx) => {
    const [current] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!current) throw new NotFoundError(`job ${jobId} not found`);
    const from = current.status as JobStatus;
    if (opts.from && !opts.from.includes(from)) return null;
    if (from === to && !opts.patch) return { job: current, from };
    if (from !== to) assertTransition(from, to);
    const now = ctx.now();
    const patch: Partial<typeof jobs.$inferInsert> = { ...opts.patch, status: to };
    if (isRunnerStage(to) && !current.startedAt) patch.startedAt = now;
    if (TERMINAL_STATUSES.includes(to) || to === "failed") patch.finishedAt = now;
    if (!isRunnerStage(to)) patch.runnerId = opts.patch?.runnerId ?? null;
    const [updated] = await tx.update(jobs).set(patch).where(eq(jobs.id, jobId)).returning();
    if (from !== to) {
      const event: FoundryEvent = { kind: "stage_changed", from, to, reason: opts.reason };
      await tx
        .insert(events)
        .values({ jobId, teamId: current.teamId, kind: event.kind, stage: to, payload: event });
    }
    return { job: updated!, from };
  });
  if (!result) return null;
  if (result.from !== result.job.status) {
    await bestEffort(ctx, "github sync", () => syncJobToGitHub(ctx, result.job, result.from));
    if (result.job.kind === "onboarding" && (to === "failed" || to === "cancelled")) {
      await ctx.db.update(repos).set({ onboardingStatus: "failed" }).where(eq(repos.id, result.job.repoId));
    }
  }
  return result.job;
}

export async function activeJobForIssue(ctx: ControlContext, repoId: string, issueNumber: number) {
  return ctx.db.query.jobs.findFirst({
    where: and(
      eq(jobs.repoId, repoId),
      eq(jobs.issueNumber, issueNumber),
      notInArray(jobs.status, ["merged", "cancelled"]),
    ),
  });
}

/** Any job for an issue, finished or not. The `foundry` trigger label outlives a cancelled job. */
async function anyJobForIssue(ctx: ControlContext, repoId: string, issueNumber: number) {
  return ctx.db.query.jobs.findFirst({
    where: and(eq(jobs.repoId, repoId), eq(jobs.issueNumber, issueNumber)),
  });
}

/** Create a job for an issue labeled `foundry`. Idempotent per issue while a job is active. */
export async function createJobFromIssue(
  ctx: ControlContext,
  repoId: string,
  issue: Pick<GhIssue, "number" | "title" | "body" | "author" | "labels">,
): Promise<Job> {
  const existing = await activeJobForIssue(ctx, repoId, issue.number);
  if (existing) return existing;
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo) throw new NotFoundError(`repo ${repoId} not found`);
  const team = await ctx.db.query.teams.findFirst({ where: eq(teams.id, repo.teamId) });
  const author = await ctx.db.query.users.findFirst({ where: eq(users.ghLogin, issue.author.toLowerCase()) });
  const labels = parseLabels(issue.labels);
  const id = randomUUID();
  const [job] = await ctx.db
    .insert(jobs)
    .values({
      id,
      teamId: repo.teamId,
      repoId,
      kind: "ticket",
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body,
      authorLogin: issue.author,
      authorUserId: author?.id ?? null,
      harness: labels.harness ?? repo.defaultHarness ?? team?.defaultHarness ?? "claude-code",
      model: labels.model ?? repo.defaultModel ?? team?.defaultModel ?? null,
      playbook: labels.playbook ?? "default",
      pinnedRunnerName: labels.runner ?? null,
      branch: jobBranchName(id, issue.title),
    })
    .onConflictDoNothing()
    .returning();
  if (!job) {
    const raced = await activeJobForIssue(ctx, repoId, issue.number);
    if (raced) return raced;
    throw new Error("failed to create job");
  }
  await recordEvents(ctx, job, [
    { kind: "stage_changed", from: null, to: "queued", reason: "issue labeled foundry" },
  ]);
  await bestEffort(ctx, "github sync", () => syncJobToGitHub(ctx, job, null));
  return job;
}

/**
 * Catch-up when smee/webhooks were down: open issues labeled `foundry` on repos that accept jobs
 * become ticket jobs. Idempotent per issue.
 */
export async function reconcileLabeledIssues(ctx: ControlContext): Promise<string[]> {
  const ready = await ctx.db.select().from(repos).where(eq(repos.acceptsJobs, true));
  const created: string[] = [];
  for (const repo of ready) {
    let issues: GhIssue[];
    try {
      issues = await ctx.gh.listIssues(repoRef(repo), { labels: [TRIGGER_LABEL], state: "open" });
    } catch (err) {
      ctx.log("list labeled issues failed", { repo: repo.fullName, error: String(err) });
      continue;
    }
    for (const issue of issues) {
      // The trigger label stays on the issue after a job finishes, so any existing job (cancelled
      // included) means this label is not a new request. Retrying revives that job instead.
      const existing = await anyJobForIssue(ctx, repo.id, issue.number);
      if (existing) continue;
      const job = await createJobFromIssue(ctx, repo.id, issue);
      created.push(job.id);
    }
  }
  return created;
}

export async function addInput(
  ctx: ControlContext,
  job: Pick<Job, "id" | "teamId" | "status">,
  input: PendingInput,
): Promise<void> {
  await ctx.db.insert(jobInputs).values({
    jobId: job.id,
    kind: input.kind,
    text: input.text,
    by: input.by,
    questionPrompt: input.questionPrompt ?? null,
  });
}

/** Undelivered human input for a job, marked delivered. */
export async function takePendingInputs(ctx: ControlContext, jobId: string): Promise<PendingInput[]> {
  const rows = await ctx.db
    .update(jobInputs)
    .set({ deliveredAt: ctx.now() })
    .where(and(eq(jobInputs.jobId, jobId), isNull(jobInputs.deliveredAt)))
    .returning();
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return rows.map((r) => ({
    kind: r.kind as PendingInput["kind"],
    text: r.text,
    by: r.by,
    ...(r.questionPrompt ? { questionPrompt: r.questionPrompt } : {}),
  }));
}

export async function listPendingInputs(ctx: ControlContext, jobId: string) {
  return ctx.db
    .select()
    .from(jobInputs)
    .where(and(eq(jobInputs.jobId, jobId), isNull(jobInputs.deliveredAt)))
    .orderBy(asc(jobInputs.createdAt));
}

/**
 * A human message for the agent (`/foundry ...`, a changes-requested review, or the panel).
 * Parked jobs go back to the queue at implementing; running jobs pick it up at the next stage.
 */
export async function sendMessage(
  ctx: ControlContext,
  jobId: string,
  text: string,
  by: string,
): Promise<Job> {
  const job = await getJob(ctx, jobId);
  await addInput(ctx, job, { kind: "message", text, by });
  await recordEvents(ctx, job, [{ kind: "message", role: "human", text: `@${by}: ${text}` }]);
  if (["pr_ci", "waiting_on_you", "failed"].includes(job.status)) {
    const moved = await transitionJob(ctx, jobId, "queued", {
      reason: `message from @${by}`,
      patch: { resumeStage: "implementing" },
      from: ["pr_ci", "waiting_on_you", "failed"],
    });
    if (moved) return moved;
  }
  return getJob(ctx, jobId);
}

export async function cancelJob(ctx: ControlContext, jobId: string, by: string): Promise<Job | null> {
  return transitionJob(ctx, jobId, "cancelled", { reason: `cancelled by @${by}` });
}

/** Re-queue a job from a chosen stage (panel "retry from stage"). */
export async function retryJob(ctx: ControlContext, jobId: string, stage: RunnerStage, by: string) {
  return transitionJob(ctx, jobId, "queued", {
    reason: `retry from ${stage} by @${by}`,
    patch: { resumeStage: stage, failureReason: null, loopCount: 0 },
  });
}
