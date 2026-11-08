import { events, jobs, memberships, questions, runners } from "@foundry/db";
import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { ControlContext } from "./context";

export interface MetricsFilter {
  teamId: string;
  days: number;
  repoId?: string | null;
}

export interface Breakdown {
  key: string;
  jobs: number;
  merged: number;
  successRate: number | null;
  medianCostPerMerged: number | null;
}

export interface TeamMetrics {
  jobs: number;
  weeklyActiveFilers: { active: number; members: number };
  ticketToPrRate: number | null;
  autoMergeRate: number | null;
  revertRate: number | null;
  medianHumanTouches: number | null;
  medianLeadTimeMin: number | null;
  medianCostPerMerged: number | null;
  goodQuestionRate: number | null;
  medianHandoverWaitMin: number | null;
  requeuedOfflineRate: number | null;
  portableResumeSuccessRate: number | null;
  medianQueueMin: number | null;
  byOs: Breakdown[];
  byHarness: Breakdown[];
  runnerUtilization: { runnerId: string; name: string; busyHours: number; utilization: number }[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const avg = (nums: number[]): number | null =>
  nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
const median = (nums: number[]): number | null => {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

type EventPayload = {
  kind?: string;
  from?: string | null;
  to?: string | null;
  reason?: string | null;
  role?: string;
  mode?: string;
};

const FINAL_STATUSES = new Set(["merged", "failed", "waiting_on_you", "pr_ci", "cancelled"]);

/** Every metric in spec 5.11, computed from the metrics_* views over `events` and `jobs`. */
export async function teamMetrics(ctx: ControlContext, f: MetricsFilter): Promise<TeamMetrics> {
  return ctx.dialect === "sqlite" ? teamMetricsSqlite(ctx, f) : teamMetricsPostgres(ctx, f);
}

/** SQLite: no percentile_cont / FILTER / metrics_* views, so aggregate the same numbers in TS. */
async function teamMetricsSqlite(ctx: ControlContext, f: MetricsFilter): Promise<TeamMetrics> {
  const since = new Date(ctx.now().getTime() - f.days * 24 * 3600_000);
  const weekAgo = new Date(ctx.now().getTime() - 7 * 24 * 3600_000);
  const jobFilter = and(
    eq(jobs.teamId, f.teamId),
    eq(jobs.kind, "ticket"),
    gte(jobs.createdAt, since),
    ...(f.repoId ? [eq(jobs.repoId, f.repoId)] : []),
  );

  const [jobRows, eventRows, handoverEvents, allStageChanges, questionRows, memberRows, filerRows] =
    await Promise.all([
      ctx.db
        .select({
          id: jobs.id,
          status: jobs.status,
          costUsd: jobs.costUsd,
          createdAt: jobs.createdAt,
          claimedAt: jobs.claimedAt,
          finishedAt: jobs.finishedAt,
          revertedAt: jobs.revertedAt,
          harness: jobs.harness,
          model: jobs.model,
          originOs: runners.os,
        })
        .from(jobs)
        .leftJoin(runners, eq(runners.id, jobs.originRunnerId))
        .where(jobFilter),
      ctx.db
        .select({
          jobId: events.jobId,
          id: events.id,
          ts: events.ts,
          kind: events.kind,
          payload: events.payload,
        })
        .from(events)
        .innerJoin(jobs, eq(jobs.id, events.jobId))
        .where(jobFilter),
      ctx.db
        .select({ jobId: events.jobId, id: events.id, ts: events.ts, payload: events.payload })
        .from(events)
        .where(and(eq(events.teamId, f.teamId), eq(events.kind, "stage_changed"), gte(events.ts, since))),
      ctx.db
        .select({ jobId: events.jobId, id: events.id, ts: events.ts, payload: events.payload })
        .from(events)
        .where(and(eq(events.teamId, f.teamId), eq(events.kind, "stage_changed"))),
      ctx.db
        .select({ helpful: questions.helpful })
        .from(questions)
        .where(
          and(eq(questions.teamId, f.teamId), isNotNull(questions.helpful), gte(questions.createdAt, since)),
        ),
      ctx.db.select({ n: count() }).from(memberships).where(eq(memberships.teamId, f.teamId)),
      ctx.db
        .select({ authorUserId: jobs.authorUserId })
        .from(jobs)
        .where(and(eq(jobs.teamId, f.teamId), gte(jobs.createdAt, weekAgo), isNotNull(jobs.authorUserId))),
    ]);

  const eventsByJob = new Map<string, EventPayload[]>();
  for (const e of eventRows) {
    const list = eventsByJob.get(e.jobId) ?? [];
    list.push(e.payload as EventPayload);
    eventsByJob.set(e.jobId, list);
  }

  const facts = jobRows.map((j) => {
    const evs = eventsByJob.get(j.id) ?? [];
    const has = (kind: string, pred: (p: EventPayload) => boolean) =>
      evs.some((e) => (e.kind ?? "") === kind && pred(e));
    const reachedPr = has("stage_changed", (p) => p.to === "pr_ci");
    const autoMerged =
      j.status === "merged" &&
      has("stage_changed", (p) => p.to === "merged" && p.reason === "confidence gate passed");
    const humanEvents = evs.filter(
      (e) => e.kind === "answer" || (e.kind === "message" && e.role === "human"),
    ).length;
    const requeuedOffline = has(
      "stage_changed",
      (p) =>
        p.to === "queued" &&
        typeof p.reason === "string" &&
        p.reason.startsWith("runner ") &&
        p.reason.endsWith(" offline"),
    );
    return {
      status: j.status,
      costUsd: j.costUsd,
      revertedAt: j.revertedAt,
      harness: j.harness,
      model: j.model,
      originOs: j.originOs,
      reachedPr,
      autoMerged,
      humanTouches: humanEvents + (j.status === "merged" && !autoMerged ? 1 : 0),
      requeuedOffline,
      leadTimeMin: j.finishedAt ? (j.finishedAt.getTime() - j.createdAt.getTime()) / 60000 : null,
      firstQueueMin: j.claimedAt ? (j.claimedAt.getTime() - j.createdAt.getTime()) / 60000 : null,
    };
  });

  const merged = facts.filter((x) => x.status === "merged");
  const autoMergedRows = facts.filter((x) => x.autoMerged);
  const portableDenom = facts.filter((x) => x.requeuedOffline && FINAL_STATUSES.has(x.status));

  // Handover waits: for each stage_changed into waiting_on_you, the next stage_changed out of it.
  const waitsByJob = new Map<string, { id: number; ts: Date; payload: EventPayload }[]>();
  for (const e of handoverEvents) {
    const list = waitsByJob.get(e.jobId) ?? [];
    list.push({ id: e.id, ts: e.ts, payload: e.payload as EventPayload });
    waitsByJob.set(e.jobId, list);
  }
  const waits: number[] = [];
  for (const list of waitsByJob.values()) {
    list.sort((a, b) => a.id - b.id);
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.payload.to !== "waiting_on_you") continue;
      const acted = list.find((n, j) => j > i && n.payload.from === "waiting_on_you");
      if (acted) waits.push((acted.ts.getTime() - list[i]!.ts.getTime()) / 60000);
    }
  }

  // Runner busy: from a claim ("stage_changed" out of queued) to the next release, per runner name.
  const claimsByJob = new Map<string, { id: number; ts: Date; payload: EventPayload }[]>();
  for (const e of allStageChanges) {
    const list = claimsByJob.get(e.jobId) ?? [];
    list.push({ id: e.id, ts: e.ts, payload: e.payload as EventPayload });
    claimsByJob.set(e.jobId, list);
  }
  const releaseTo = new Set(["queued", "needs_input", "pr_ci", "failed", "cancelled"]);
  const busyByRunner = new Map<string, number>();
  const now = ctx.now();
  for (const list of claimsByJob.values()) {
    list.sort((a, b) => a.id - b.id);
    for (let i = 0; i < list.length; i++) {
      const claim = list[i]!;
      if (claim.payload.from !== "queued") continue;
      const reason = claim.payload.reason ?? "";
      const name = reason.startsWith("claimed by ") ? reason.slice("claimed by ".length) : null;
      if (!name) continue;
      const release = list.find(
        (n, j) => j > i && n.payload.to !== null && n.payload.to !== undefined && releaseTo.has(n.payload.to),
      );
      const start = claim.ts.getTime();
      const end = release ? release.ts.getTime() : now.getTime();
      const overlap = Math.min(end, now.getTime()) - Math.max(start, since.getTime());
      if (overlap > 0) busyByRunner.set(name, (busyByRunner.get(name) ?? 0) + overlap / 3_600_000);
    }
  }
  const runnerRows = await ctx.db
    .select({ id: runners.id, name: runners.name })
    .from(runners)
    .where(eq(runners.teamId, f.teamId));
  const workingHours = Math.max(1, Math.round((f.days * 5) / 7) * 8);

  const breakdown = (key: (x: (typeof facts)[number]) => string): Breakdown[] => {
    const byKey = new Map<string, (typeof facts)[number][]>();
    for (const fact of facts) {
      const k = key(fact);
      const list = byKey.get(k) ?? [];
      list.push(fact);
      byKey.set(k, list);
    }
    return [...byKey.entries()]
      .map(([k, list]) => {
        const m = list.filter((x) => x.status === "merged");
        const denom = list.filter((x) => FINAL_STATUSES.has(x.status));
        return {
          key: k,
          jobs: list.length,
          merged: m.length,
          successRate: avg(denom.map((x) => (x.status === "merged" ? 1 : 0))),
          medianCostPerMerged: median(m.map((x) => x.costUsd)),
        };
      })
      .sort((a, b) => b.jobs - a.jobs);
  };

  return {
    jobs: facts.length,
    weeklyActiveFilers: {
      active: new Set(filerRows.map((r) => r.authorUserId)).size,
      members: Number(memberRows[0]?.n ?? 0),
    },
    ticketToPrRate: avg(facts.filter((x) => FINAL_STATUSES.has(x.status)).map((x) => (x.reachedPr ? 1 : 0))),
    autoMergeRate: avg(merged.map((x) => (x.autoMerged ? 1 : 0))),
    revertRate: avg(autoMergedRows.map((x) => (x.revertedAt ? 1 : 0))),
    medianHumanTouches: median(merged.map((x) => x.humanTouches)),
    medianLeadTimeMin: median(merged.map((x) => x.leadTimeMin).filter((x): x is number => x !== null)),
    medianCostPerMerged: median(merged.map((x) => x.costUsd)),
    goodQuestionRate: avg(questionRows.map((q) => (q.helpful ? 1 : 0))),
    medianHandoverWaitMin: median(waits),
    requeuedOfflineRate: avg(facts.map((x) => (x.requeuedOffline ? 1 : 0))),
    portableResumeSuccessRate: avg(
      portableDenom.map((x) => (x.status === "merged" && x.humanTouches === 0 ? 1 : 0)),
    ),
    medianQueueMin: median(facts.map((x) => x.firstQueueMin).filter((x): x is number => x !== null)),
    byOs: breakdown((x) => x.originOs ?? "unknown"),
    byHarness: breakdown((x) => `${x.harness}${x.model ? ` / ${x.model}` : ""}`),
    runnerUtilization: runnerRows.map((r) => {
      const busyHours = busyByRunner.get(r.name) ?? 0;
      return { runnerId: r.id, name: r.name, busyHours, utilization: Math.min(1, busyHours / workingHours) };
    }),
  };
}

async function teamMetricsPostgres(ctx: ControlContext, f: MetricsFilter): Promise<TeamMetrics> {
  // ISO strings, not Date: nested drizzle fragments stringify Date with the locale
  // (e.g. "Sat Oct 10 2026 … (中国标准时间)"), which Postgres rejects.
  const since = new Date(ctx.now().getTime() - f.days * 24 * 3600_000).toISOString();
  const weekAgo = new Date(ctx.now().getTime() - 7 * 24 * 3600_000).toISOString();
  const repo = f.repoId ? sql`and repo_id = ${f.repoId}` : sql``;
  const facts = sql`(select * from metrics_job_facts where team_id = ${f.teamId} and kind = 'ticket' and created_at >= ${since}::timestamptz ${repo}) f`;

  const [s] = (await ctx.db.execute(sql`
    select
      count(*)::int as jobs,
      avg(case when reached_pr then 1.0 else 0 end) filter (where status in ('merged','failed','waiting_on_you','pr_ci','cancelled')) as ticket_to_pr,
      avg(case when auto_merged then 1.0 else 0 end) filter (where status = 'merged') as auto_merge,
      avg(case when reverted_at is not null then 1.0 else 0 end) filter (where auto_merged) as revert_rate,
      percentile_cont(0.5) within group (order by human_touches) filter (where status = 'merged') as touches,
      percentile_cont(0.5) within group (order by lead_time_min) filter (where status = 'merged') as lead_time,
      percentile_cont(0.5) within group (order by cost_usd) filter (where status = 'merged') as cost,
      avg(case when requeued_offline then 1.0 else 0 end) as requeued,
      avg(case when status = 'merged' and human_touches = 0 then 1.0 else 0 end) filter (where requeued_offline and status in ('merged','failed','waiting_on_you','cancelled')) as portable_ok,
      percentile_cont(0.5) within group (order by first_queue_min) filter (where first_queue_min is not null) as queue_min
    from ${facts}
  `)) as unknown as Record<string, unknown>[];

  const [filers] = (await ctx.db.execute(sql`
    select
      (select count(distinct author_user_id) from jobs where team_id = ${f.teamId} and created_at >= ${weekAgo}::timestamptz and author_user_id is not null)::int as active,
      (select count(*) from memberships where team_id = ${f.teamId})::int as members
  `)) as unknown as { active: number; members: number }[];

  const [q] = (await ctx.db.execute(sql`
    select avg(case when helpful then 1.0 else 0 end) as good
    from questions where team_id = ${f.teamId} and helpful is not null and created_at >= ${since}::timestamptz
  `)) as unknown as Record<string, unknown>[];

  const [h] = (await ctx.db.execute(sql`
    select percentile_cont(0.5) within group (order by extract(epoch from (acted_at - handed_at)) / 60) as wait
    from metrics_handover_waits where team_id = ${f.teamId} and handed_at >= ${since}::timestamptz and acted_at is not null
  `)) as unknown as Record<string, unknown>[];

  const breakdown = async (column: "origin_os" | "harness_model"): Promise<Breakdown[]> => {
    const key =
      column === "origin_os"
        ? sql`coalesce(origin_os, 'unknown')`
        : sql`harness || coalesce(' / ' || model, '')`;
    const rows = (await ctx.db.execute(sql`
      select ${key} as key, count(*)::int as jobs,
        count(*) filter (where status = 'merged')::int as merged,
        avg(case when status = 'merged' then 1.0 else 0 end) filter (where status in ('merged','failed','cancelled','waiting_on_you')) as success,
        percentile_cont(0.5) within group (order by cost_usd) filter (where status = 'merged') as cost
      from ${facts} group by 1 order by 2 desc
    `)) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      key: String(r.key),
      jobs: Number(r.jobs),
      merged: Number(r.merged),
      successRate: num(r.success),
      medianCostPerMerged: num(r.cost),
    }));
  };

  const util = (await ctx.db.execute(sql`
    select b.runner_id, r.name,
      sum(extract(epoch from (least(b.ended_at, now()) - greatest(b.started_at, ${since}::timestamptz)))) / 3600 as busy_hours
    from metrics_runner_busy b join runners r on r.id = b.runner_id
    where b.team_id = ${f.teamId} and b.ended_at >= ${since}::timestamptz
    group by 1, 2 order by 3 desc
  `)) as unknown as Record<string, unknown>[];
  // Working hours: 8 h on weekdays.
  const workingHours = Math.max(1, Math.round((f.days * 5) / 7) * 8);

  return {
    jobs: Number(s?.jobs ?? 0),
    weeklyActiveFilers: { active: filers?.active ?? 0, members: filers?.members ?? 0 },
    ticketToPrRate: num(s?.ticket_to_pr),
    autoMergeRate: num(s?.auto_merge),
    revertRate: num(s?.revert_rate),
    medianHumanTouches: num(s?.touches),
    medianLeadTimeMin: num(s?.lead_time),
    medianCostPerMerged: num(s?.cost),
    goodQuestionRate: num(q?.good),
    medianHandoverWaitMin: num(h?.wait),
    requeuedOfflineRate: num(s?.requeued),
    portableResumeSuccessRate: num(s?.portable_ok),
    medianQueueMin: num(s?.queue_min),
    byOs: await breakdown("origin_os"),
    byHarness: await breakdown("harness_model"),
    runnerUtilization: util.map((u) => {
      const busy = Number(u.busy_hours ?? 0);
      return {
        runnerId: String(u.runner_id),
        name: String(u.name),
        busyHours: busy,
        utilization: Math.min(1, busy / workingHours),
      };
    }),
  };
}
