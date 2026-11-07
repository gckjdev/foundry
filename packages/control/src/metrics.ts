import { sql } from "drizzle-orm";
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

/** Every metric in spec 5.11, computed from the metrics_* views over `events` and `jobs`. */
export async function teamMetrics(ctx: ControlContext, f: MetricsFilter): Promise<TeamMetrics> {
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
