import { events, type Job, jobs, type Runner, repos, runnerRepoReadiness, runners, teams } from "@foundry/db";
import {
  type ClaimedJob,
  type FoundryEvent,
  type HarnessInfo,
  ineligibility,
  isRunnerStage,
  RUNNING_STATUSES,
  type RunnerStage,
  rankRunners,
  type SchedJob,
  type SchedRunner,
} from "@foundry/shared";
import { and, asc, count, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { bestEffort, type ControlContext } from "./context";
import { syncJobToGitHub } from "./github-sync";
import { takePendingInputs } from "./jobs";
import { effectiveMergeMode, repoRecipe } from "./repos";

/** Current view of every runner in the team, in the shape the scheduler wants. */
export async function schedulerSnapshot(ctx: ControlContext, teamId: string): Promise<SchedRunner[]> {
  const rows = await ctx.db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, teamId), ne(runners.status, "removed")));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const running = await ctx.db
    .select({ runnerId: jobs.runnerId, n: count() })
    .from(jobs)
    .where(and(inArray(jobs.runnerId, ids), inArray(jobs.status, [...RUNNING_STATUSES])))
    .groupBy(jobs.runnerId);
  const ready = await ctx.db
    .select({
      runnerId: runnerRepoReadiness.runnerId,
      repoId: runnerRepoReadiness.repoId,
      sha: runnerRepoReadiness.recipeSha,
      repoSha: repos.recipeSha,
    })
    .from(runnerRepoReadiness)
    .innerJoin(repos, eq(repos.id, runnerRepoReadiness.repoId))
    .where(and(inArray(runnerRepoReadiness.runnerId, ids), eq(runnerRepoReadiness.ready, true)));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as SchedRunner["kind"],
    os: r.os as SchedRunner["os"],
    ownerUserId: r.ownerUserId,
    lastSeenAt: r.lastSeenAt,
    accepting: r.accepting,
    draining: r.status === "draining",
    running: running.find((x) => x.runnerId === r.id)?.n ?? 0,
    maxConcurrency: r.maxConcurrency,
    // Readiness only counts for the recipe version it was checked against.
    readyRepoIds: ready.filter((x) => x.runnerId === r.id && x.sha === x.repoSha).map((x) => x.repoId),
    harnesses: (r.harnesses as HarnessInfo[]).filter((h) => h.installed && h.authOk).map((h) => h.id),
  }));
}

function toSchedJob(job: Job, allowedOs: SchedJob["allowedOs"]): SchedJob {
  return {
    id: job.id,
    repoId: job.repoId,
    harness: job.harness,
    pinnedRunnerName: job.pinnedRunnerName,
    stickyRunnerId: job.stickyRunnerId,
    stickyUntil: job.stickyUntil,
    authorUserId: job.authorUserId,
    allowedOs,
  };
}

/**
 * Hand the best queued job to this runner, if the scheduler (spec 5.9) says this runner should
 * take it. The row is locked with SKIP LOCKED so two runners never claim the same job.
 */
export async function claimJob(ctx: ControlContext, runner: Runner): Promise<ClaimedJob | null> {
  if (runner.status !== "active") return null;
  const now = ctx.now();
  if (await overDailySpendCap(ctx, runner.teamId)) return null;
  const snapshot = await schedulerSnapshot(ctx, runner.teamId);
  const queued = await ctx.db
    .select({ job: jobs, repo: repos })
    .from(jobs)
    .innerJoin(repos, eq(repos.id, jobs.repoId))
    .where(and(eq(jobs.teamId, runner.teamId), eq(jobs.status, "queued")))
    .orderBy(asc(jobs.createdAt))
    .limit(50);

  for (const { job, repo } of queued) {
    // Onboarding jobs run before the repo has a recipe; ticket jobs need a ready runner.
    const recipe = repoRecipe(repo);
    const schedJob = toSchedJob(job, recipe?.os ?? null);
    let pool = snapshot;
    if (job.kind === "onboarding") {
      pool = snapshot.map((r) => ({ ...r, readyRepoIds: [...r.readyRepoIds, repo.id] }));
    } else if (!repo.acceptsJobs) {
      continue;
    }
    if (rankRunners(schedJob, pool, now)[0]?.id !== runner.id) continue;

    const resumeStage: RunnerStage = isRunnerStage(job.resumeStage) ? job.resumeStage : "triage";
    const sticky = !!job.harnessSessionId && job.stickyRunnerId === runner.id;
    const resumed = job.resumeCount > 0 || job.lastCompletedStage !== null || resumeStage !== "triage";
    const resumeMode: ClaimedJob["resumeMode"] = sticky ? "sticky" : resumed ? "portable" : "fresh";

    const patch = {
      status: resumeStage,
      runnerId: runner.id,
      originRunnerId: job.originRunnerId ?? runner.id,
      claimedAt: now,
      startedAt: job.startedAt ?? now,
      stickyRunnerId: null,
      stickyUntil: null,
      resumeCount: resumeMode === "fresh" ? job.resumeCount : job.resumeCount + 1,
      // A different machine cannot continue another machine's native session.
      harnessSessionId: sticky ? job.harnessSessionId : null,
    };
    const list: FoundryEvent[] = [
      { kind: "stage_changed", from: "queued", to: resumeStage, reason: `claimed by ${runner.name}` },
    ];
    if (resumeMode !== "fresh") {
      list.push({
        kind: "resumed",
        runnerId: runner.id,
        runnerName: runner.name,
        mode: resumeMode,
        harnessChanged: false,
      });
    }
    const eventRows = (jobId: string, teamId: string) =>
      list.map((e) => ({ jobId, teamId, kind: e.kind, stage: resumeStage, payload: e }));

    const claimed =
      ctx.dialect === "sqlite"
        ? await (async () => {
            // SQLite has no FOR UPDATE SKIP LOCKED; a conditional UPDATE is atomic and exclusive.
            const [row] = await ctx.db
              .update(jobs)
              .set(patch)
              .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued")))
              .returning();
            if (!row) return null;
            await ctx.db.insert(events).values(eventRows(row.id, row.teamId));
            return row;
          })()
        : await ctx.db.transaction(async (tx) => {
            const [row] = await tx
              .update(jobs)
              .set(patch)
              .where(
                sql`${jobs.id} = (select id from jobs where id = ${job.id} and status = 'queued' for update skip locked)`,
              )
              .returning();
            if (!row) return null;
            await tx.insert(events).values(eventRows(row.id, row.teamId));
            return row;
          });
    if (!claimed) continue;

    await bestEffort(ctx, "github sync", () => syncJobToGitHub(ctx, claimed, "queued"));
    const pendingInputs = await takePendingInputs(ctx, claimed.id);
    return {
      id: claimed.id,
      kind: claimed.kind as ClaimedJob["kind"],
      repo: { id: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch },
      issueNumber: claimed.issueNumber,
      title: claimed.title,
      body: claimed.body,
      author: claimed.authorLogin,
      harness: claimed.harness,
      model: claimed.model,
      playbook: claimed.playbook,
      branch: claimed.branch,
      resumeStage,
      sessionId: claimed.harnessSessionId,
      resumeMode,
      loopCount: claimed.loopCount,
      costUsd: claimed.costUsd,
      pendingInputs,
      mergeMode: effectiveMergeMode(repo),
    };
  }
  return null;
}

/** Agent spend since local midnight (UTC on servers), from usage events. */
export async function spendToday(ctx: ControlContext, teamId: string): Promise<number> {
  const start = new Date(ctx.now());
  start.setHours(0, 0, 0, 0);
  if (ctx.dialect === "sqlite") {
    const rows = await ctx.db
      .select({ payload: events.payload })
      .from(events)
      .where(and(eq(events.teamId, teamId), eq(events.kind, "usage"), gte(events.ts, start)));
    return rows.reduce((sum, r) => sum + ((r.payload as { costUsd?: number } | null)?.costUsd ?? 0), 0);
  }
  const [row] = await ctx.db
    .select({ total: sql<string | null>`sum((${events.payload}->>'costUsd')::float8)` })
    .from(events)
    .where(and(eq(events.teamId, teamId), eq(events.kind, "usage"), gte(events.ts, start)));
  return Number(row?.total ?? 0);
}

export async function overDailySpendCap(ctx: ControlContext, teamId: string): Promise<boolean> {
  const team = await ctx.db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team?.dailySpendCapUsd) return false;
  return (await spendToday(ctx, teamId)) >= team.dailySpendCapUsd;
}

export type QueueDiagnosis = { jobId: string; reason: string | null };

/** Why each queued job is still waiting ("no runner online", "repo not ready", ...). */
export async function diagnoseQueue(ctx: ControlContext, teamId: string): Promise<QueueDiagnosis[]> {
  const now = ctx.now();
  const snapshot = await schedulerSnapshot(ctx, teamId);
  const queued = await ctx.db
    .select({ job: jobs, repo: repos })
    .from(jobs)
    .innerJoin(repos, eq(repos.id, jobs.repoId))
    .where(and(eq(jobs.teamId, teamId), eq(jobs.status, "queued")));
  if (queued.length > 0 && (await overDailySpendCap(ctx, teamId))) {
    return queued.map(({ job }) => ({ jobId: job.id, reason: "daily spend cap reached" }));
  }
  return queued.map(({ job, repo }) => {
    if (job.kind !== "onboarding" && !repo.acceptsJobs)
      return { jobId: job.id, reason: "repo not onboarded" };
    if (snapshot.length === 0) return { jobId: job.id, reason: "no runners joined" };
    const schedJob = toSchedJob(job, repoRecipe(repo)?.os ?? null);
    const pool =
      job.kind === "onboarding" ? snapshot.map((r) => ({ ...r, readyRepoIds: [repo.id] })) : snapshot;
    if (rankRunners(schedJob, pool, now).length > 0) return { jobId: job.id, reason: null };
    const reasons = pool.map((r) => ineligibility(schedJob, r, now));
    if (reasons.every((r) => r === "offline")) return { jobId: job.id, reason: "no runner online" };
    if (job.stickyRunnerId && job.stickyUntil && job.stickyUntil > now) {
      return { jobId: job.id, reason: "reserved for the runner holding its session" };
    }
    const first = reasons.find((r) => r !== null && r !== "offline") ?? "offline";
    return { jobId: job.id, reason: first.replaceAll("_", " ") };
  });
}
