import {
  events,
  evidence,
  type Job,
  jobs,
  questions,
  type Repo,
  repos,
  runnerRepoReadiness,
  runners,
  users,
} from "@foundry/db";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { diagnoseQueue } from "./claim";
import type { ControlContext } from "./context";
import { syncChangesRequestedReview, syncMergedPullRequest } from "./merge-gate";

/** The `jobs` columns the board renders. Selecting the whole row pulled issue bodies and plans. */
const BOARD_JOB_COLUMNS = {
  id: jobs.id,
  repoId: jobs.repoId,
  issueNumber: jobs.issueNumber,
  title: jobs.title,
  status: jobs.status,
  harness: jobs.harness,
  costUsd: jobs.costUsd,
  updatedAt: jobs.updatedAt,
} as const;

export type BoardJobRow = Pick<Job, keyof typeof BOARD_JOB_COLUMNS>;

export interface BoardJob {
  job: BoardJobRow;
  repoFullName: string;
  runnerName: string | null;
  waitingReason: string | null;
}

/** Statuses the board files under "Stopped" (plus merged, which is "Done"). */
const FINISHED_STATUSES: readonly string[] = ["merged", "cancelled", "failed"];

/**
 * Jobs for the board: everything active plus the last week's finished work.
 * One issue has at most one card: when a cancelled/failed job and a newer live job both exist
 * (retry, or an explicit re-label), the live job is the one shown.
 *
 * This is a read path: it does not talk to GitHub. Labeled issues are turned into jobs by the
 * `issues.labeled` webhook and, as a catch-up, by the worker's poll every `SWEEP_INTERVAL_MS`
 * (`reconcileLabeledIssues`). Doing that here made every page load — and every realtime
 * `router.refresh()` — wait on one GitHub API call per onboarded repo.
 */
export async function boardJobs(ctx: ControlContext, teamId: string): Promise<BoardJob[]> {
  const weekAgo = new Date(ctx.now().getTime() - 7 * 24 * 3600_000);
  const [rows, diagnosis] = await Promise.all([
    ctx.db
      .select({ job: BOARD_JOB_COLUMNS, repoFullName: repos.fullName, runnerName: runners.name })
      .from(jobs)
      .innerJoin(repos, eq(repos.id, jobs.repoId))
      .leftJoin(runners, eq(runners.id, jobs.runnerId))
      .where(
        and(
          eq(jobs.teamId, teamId),
          or(notInArray(jobs.status, ["merged", "cancelled", "failed"]), gt(jobs.updatedAt, weekAgo)),
        ),
      )
      .orderBy(desc(jobs.updatedAt))
      .limit(300),
    diagnoseQueue(ctx, teamId),
  ]);
  const reasons = new Map(diagnosis.map((d) => [d.jobId, d.reason]));
  const byIssue = new Map<string, (typeof rows)[number]>();
  const withoutIssue: (typeof rows)[number][] = [];
  for (const row of rows) {
    if (row.job.issueNumber === null) {
      withoutIssue.push(row);
      continue;
    }
    const key = `${row.job.repoId}:${row.job.issueNumber}`;
    const kept = byIssue.get(key);
    // Rows are newest first, so keep the first unless it is finished and a live job exists.
    if (
      !kept ||
      (FINISHED_STATUSES.includes(kept.job.status) && !FINISHED_STATUSES.includes(row.job.status))
    ) {
      byIssue.set(key, row);
    }
  }
  return [...byIssue.values(), ...withoutIssue]
    .sort((a, b) => b.job.updatedAt.getTime() - a.job.updatedAt.getTime())
    .map((r) => ({ ...r, waitingReason: reasons.get(r.job.id) ?? null }));
}

export async function jobDetail(ctx: ControlContext, teamId: string, jobId: string) {
  const [found] = await ctx.db
    .select({ job: jobs, repo: repos, runnerName: runners.name })
    .from(jobs)
    .innerJoin(repos, eq(repos.id, jobs.repoId))
    .leftJoin(runners, eq(runners.id, jobs.runnerId))
    .where(and(eq(jobs.id, jobId), eq(jobs.teamId, teamId)));
  if (!found) return null;
  let row = found;
  const synced = await syncMergedPullRequest(ctx, row.job);
  if (synced) {
    const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, row.repo.id) });
    row = { job: synced, repo: repo ?? row.repo, runnerName: row.runnerName };
  } else {
    const requeued = await syncChangesRequestedReview(ctx, row.job);
    if (requeued) row = { job: requeued, repo: row.repo, runnerName: row.runnerName };
  }
  const [timeline, ev, qs] = await Promise.all([
    ctx.db.select().from(events).where(eq(events.jobId, jobId)).orderBy(asc(events.id)).limit(2000),
    ctx.db.select().from(evidence).where(eq(evidence.jobId, jobId)).orderBy(asc(evidence.createdAt)),
    ctx.db.select().from(questions).where(eq(questions.jobId, jobId)).orderBy(asc(questions.createdAt)),
  ]);
  return { ...row, timeline, evidence: ev, questions: qs };
}

export async function eventsSince(ctx: ControlContext, teamId: string, jobId: string, afterId: number) {
  return ctx.db
    .select()
    .from(events)
    .where(and(eq(events.jobId, jobId), eq(events.teamId, teamId), gt(events.id, afterId)))
    .orderBy(asc(events.id))
    .limit(500);
}

/** The `jobs` columns the inbox renders (plus the routing fields its rows are filtered on). */
const INBOX_JOB_COLUMNS = {
  id: jobs.id,
  title: jobs.title,
  status: jobs.status,
  updatedAt: jobs.updatedAt,
  prUrl: jobs.prUrl,
  assignedReviewers: jobs.assignedReviewers,
  authorUserId: jobs.authorUserId,
  authorLogin: jobs.authorLogin,
} as const;

export type InboxJob = Pick<Job, keyof typeof INBOX_JOB_COLUMNS>;

/**
 * Per-member inbox (spec 5.6/5.7/5.12): questions addressed to me, PRs handed to me, my own tickets
 * in flight — including queued ones blocked by the scheduler — and the unassigned lane of handovers
 * nobody was routed to.
 *
 * Like the board, this read path stays off GitHub: the webhook and the worker's catch-up poll own
 * labeled-issue reconciliation.
 */
export async function inbox(ctx: ControlContext, teamId: string, userId: string) {
  // The handover list does not need the user row, so fetch it alongside the lookup.
  const [user, handovers] = await Promise.all([
    ctx.db.query.users.findFirst({ where: eq(users.id, userId) }),
    ctx.db
      .select(INBOX_JOB_COLUMNS)
      .from(jobs)
      .where(and(eq(jobs.teamId, teamId), eq(jobs.status, "waiting_on_you")))
      .orderBy(desc(jobs.updatedAt)),
  ]);
  if (!user) return { questions: [], reviews: [], mine: [], unassigned: [], blocked: [] };
  const login = user.ghLogin;
  const [openQuestions, mine, diagnosis] = await Promise.all([
    ctx.db
      .select({ question: questions, job: INBOX_JOB_COLUMNS })
      .from(questions)
      .innerJoin(jobs, eq(jobs.id, questions.jobId))
      .where(
        and(eq(questions.teamId, teamId), isNull(questions.answeredAt), eq(questions.askedLogin, login)),
      ),
    ctx.db
      .select(INBOX_JOB_COLUMNS)
      .from(jobs)
      .where(
        and(
          eq(jobs.teamId, teamId),
          or(eq(jobs.authorUserId, userId), sql`lower(${jobs.authorLogin}) = ${login}`),
          notInArray(jobs.status, ["merged", "cancelled"]),
        ),
      )
      .orderBy(desc(jobs.updatedAt)),
    // Runs for every inbox load so it overlaps the queries above; only queued rows use it.
    diagnoseQueue(ctx, teamId),
  ]);
  const routedTo = (j: InboxJob) => ((j.assignedReviewers as string[]) ?? []).map((r) => r.toLowerCase());
  const queuedMine = mine.filter((j) => j.status === "queued");
  const reasons = new Map<string, string | null>(diagnosis.map((d) => [d.jobId, d.reason]));
  const blocked = queuedMine.flatMap((job) => {
    const reason = reasons.get(job.id);
    return reason ? [{ job, reason }] : [];
  });
  return {
    questions: openQuestions,
    reviews: handovers.filter((j) => routedTo(j).includes(login)),
    mine,
    unassigned: handovers.filter((j) => routedTo(j).length === 0),
    blocked,
  };
}

export async function teamRepos(ctx: ControlContext, teamId: string) {
  return ctx.db.select().from(repos).where(eq(repos.teamId, teamId)).orderBy(asc(repos.fullName));
}

export interface RepoRunnerReadiness {
  runnerId: string;
  runnerName: string;
  ready: boolean;
  reason: string | null;
  recipeSha: string | null;
  checkedAt: Date;
}

export interface TeamRepoWithReadiness {
  repo: Repo;
  /** Pull request opened by the repo's most recent onboarding job, if it got that far. */
  recipePrUrl: string | null;
  /** One row per runner that has reported readiness for the repo, ordered by runner name. */
  readiness: RepoRunnerReadiness[];
}

/**
 * Repos plus the readiness details spec 5.6 shows on the Repos screen: the recipe PR opened by
 * onboarding, and each runner's last report for the repo. Runners that have not reported yet are
 * omitted.
 */
export async function teamReposWithReadiness(
  ctx: ControlContext,
  teamId: string,
): Promise<TeamRepoWithReadiness[]> {
  const list = await teamRepos(ctx, teamId);
  if (list.length === 0) return [];
  const repoIds = list.map((repo) => repo.id);
  const [onboarding, reports] = await Promise.all([
    ctx.db
      .select({ repoId: jobs.repoId, prUrl: jobs.prUrl })
      .from(jobs)
      .where(and(eq(jobs.teamId, teamId), eq(jobs.kind, "onboarding"), isNotNull(jobs.prUrl)))
      .orderBy(desc(jobs.createdAt), desc(jobs.id)),
    ctx.db
      .select({
        repoId: runnerRepoReadiness.repoId,
        runnerId: runnerRepoReadiness.runnerId,
        runnerName: runners.name,
        ready: runnerRepoReadiness.ready,
        reason: runnerRepoReadiness.reason,
        recipeSha: runnerRepoReadiness.recipeSha,
        checkedAt: runnerRepoReadiness.checkedAt,
      })
      .from(runnerRepoReadiness)
      .innerJoin(runners, eq(runners.id, runnerRepoReadiness.runnerId))
      .where(and(inArray(runnerRepoReadiness.repoId, repoIds), ne(runners.status, "removed")))
      .orderBy(asc(runners.name)),
  ]);

  const prByRepo = new Map<string, string>();
  for (const row of onboarding) {
    if (row.prUrl && !prByRepo.has(row.repoId)) prByRepo.set(row.repoId, row.prUrl);
  }
  const readinessByRepo = new Map<string, RepoRunnerReadiness[]>();
  for (const { repoId, ...row } of reports) {
    const bucket = readinessByRepo.get(repoId) ?? [];
    bucket.push(row);
    readinessByRepo.set(repoId, bucket);
  }
  return list.map((repo) => ({
    repo,
    recipePrUrl: prByRepo.get(repo.id) ?? null,
    readiness: readinessByRepo.get(repo.id) ?? [],
  }));
}

export async function runningJobsByRunner(ctx: ControlContext, runnerIds: string[]) {
  if (runnerIds.length === 0) return [];
  return ctx.db
    .select({ id: jobs.id, title: jobs.title, status: jobs.status, runnerId: jobs.runnerId })
    .from(jobs)
    .where(
      and(
        inArray(jobs.runnerId, runnerIds),
        inArray(jobs.status, ["triage", "investigating", "implementing", "reviewing", "verifying"]),
      ),
    );
}
