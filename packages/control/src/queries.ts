import { events, evidence, type Job, jobs, questions, repos, runners, users } from "@foundry/db";
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { diagnoseQueue } from "./claim";
import type { ControlContext } from "./context";
import { syncMergedPullRequest } from "./merge-gate";

export interface BoardJob {
  job: Job;
  repoFullName: string;
  runnerName: string | null;
  waitingReason: string | null;
}

/** Jobs for the board: everything active plus the last week's finished work. */
export async function boardJobs(ctx: ControlContext, teamId: string): Promise<BoardJob[]> {
  const weekAgo = new Date(ctx.now().getTime() - 7 * 24 * 3600_000);
  const rows = await ctx.db
    .select({ job: jobs, repoFullName: repos.fullName, runnerName: runners.name })
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
    .limit(300);
  const diagnosis = new Map((await diagnoseQueue(ctx, teamId)).map((d) => [d.jobId, d.reason]));
  return rows.map((r) => ({ ...r, waitingReason: diagnosis.get(r.job.id) ?? null }));
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

/**
 * Per-member inbox (spec 5.7/5.12): questions addressed to me, PRs handed to me, my own tickets
 * in flight, and the unassigned lane of handovers nobody was routed to.
 */
export async function inbox(ctx: ControlContext, teamId: string, userId: string) {
  const user = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { questions: [], reviews: [], mine: [], unassigned: [] };
  const login = user.ghLogin;
  const [openQuestions, handovers, mine] = await Promise.all([
    ctx.db
      .select({ question: questions, job: jobs })
      .from(questions)
      .innerJoin(jobs, eq(jobs.id, questions.jobId))
      .where(
        and(eq(questions.teamId, teamId), isNull(questions.answeredAt), eq(questions.askedLogin, login)),
      ),
    ctx.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.teamId, teamId), eq(jobs.status, "waiting_on_you")))
      .orderBy(desc(jobs.updatedAt)),
    ctx.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.teamId, teamId),
          or(eq(jobs.authorUserId, userId), sql`lower(${jobs.authorLogin}) = ${login}`),
          notInArray(jobs.status, ["merged", "cancelled"]),
        ),
      )
      .orderBy(desc(jobs.updatedAt)),
  ]);
  const routedTo = (j: Job) => ((j.assignedReviewers as string[]) ?? []).map((r) => r.toLowerCase());
  return {
    questions: openQuestions,
    reviews: handovers.filter((j) => routedTo(j).includes(login)),
    mine,
    unassigned: handovers.filter((j) => routedTo(j).length === 0),
  };
}

export async function teamRepos(ctx: ControlContext, teamId: string) {
  return ctx.db.select().from(repos).where(eq(repos.teamId, teamId)).orderBy(asc(repos.fullName));
}

export async function runningJobsByRunner(ctx: ControlContext, runnerIds: string[]) {
  if (runnerIds.length === 0) return [];
  return ctx.db
    .select({ id: jobs.id, title: jobs.title, status: jobs.status, runnerId: jobs.runnerId })
    .from(jobs)
    .where(
      and(
        inArray(jobs.runnerId, runnerIds),
        inArray(jobs.status, ["triage", "investigating", "implementing", "verifying"]),
      ),
    );
}
