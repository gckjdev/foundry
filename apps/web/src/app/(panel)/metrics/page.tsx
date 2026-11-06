import { type Breakdown, teamMetrics, teamRepos } from "@foundry/control";
import { pct, usd } from "@/components/status";
import { requireTeam } from "@/server/session";

function Stat({ label, value, target }: { label: string; value: string; target?: string }) {
  return (
    <div className="card">
      <div className="stat">{value}</div>
      <div className="stat-label">{label}</div>
      {target ? <div className="faint small" style={{ marginTop: 4 }}>target {target}</div> : null}
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <section className="card">
      <h2 style={{ marginBottom: 10 }}>{title}</h2>
      {rows.length === 0 ? (
        <div className="faint">No finished jobs in this window.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th />
              <th>Jobs</th>
              <th>Merged</th>
              <th>Success</th>
              <th>Cost / merged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td>{r.jobs}</td>
                <td>{r.merged}</td>
                <td>{pct(r.successRate)}</td>
                <td>{usd(r.medianCostPerMerged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const minutes = (n: number | null) => (n === null ? "—" : n < 90 ? `${Math.round(n)}m` : `${(n / 60).toFixed(1)}h`);

export default async function Metrics({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { ctx, team } = await requireTeam();
  const sp = await searchParams;
  const days = [7, 28, 90].includes(Number(sp.days)) ? Number(sp.days) : 28;
  const repos = await teamRepos(ctx, team.id);
  const repoId = repos.some((r) => r.id === sp.repo) ? sp.repo! : null;
  const m = await teamMetrics(ctx, { teamId: team.id, days, repoId });
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{team.name}</div>
          <h1>Metrics</h1>
        </div>
        <form className="row">
          <select name="days" defaultValue={String(days)}>
            <option value="7">Last 7 days</option>
            <option value="28">Last 28 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <select name="repo" defaultValue={repoId ?? ""}>
            <option value="">All repos</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName}
              </option>
            ))}
          </select>
          <button type="submit">Apply</button>
        </form>
      </div>
      <div className="grid grid-4">
        <Stat
          label="weekly active filers"
          value={`${m.weeklyActiveFilers.active}/${m.weeklyActiveFilers.members}`}
          target="≥ 70% of team"
        />
        <Stat label="ticket → green PR" value={pct(m.ticketToPrRate)} target="≥ 70%" />
        <Stat label="auto-merge rate" value={pct(m.autoMergeRate)} target="≥ 40%" />
        <Stat label="revert rate (auto-merged)" value={pct(m.revertRate)} target="≤ 5%" />
        <Stat label="human touches / merged PR" value={m.medianHumanTouches?.toFixed(1) ?? "—"} target="≤ 1.0" />
        <Stat label="lead time (median)" value={minutes(m.medianLeadTimeMin)} target="< 45m" />
        <Stat label="cost / merged PR" value={usd(m.medianCostPerMerged)} target="< $3" />
        <Stat label="good questions" value={pct(m.goodQuestionRate)} target="≥ 80%" />
        <Stat label="handover wait (median)" value={minutes(m.medianHandoverWaitMin)} target="< 4h" />
        <Stat label="re-queued (runner offline)" value={pct(m.requeuedOfflineRate)} />
        <Stat label="portable resume success" value={pct(m.portableResumeSuccessRate)} target="≥ 90%" />
        <Stat label="time in queue (median)" value={minutes(m.medianQueueMin)} />
      </div>
      <div className="grid grid-2" style={{ marginTop: 14, alignItems: "start" }}>
        <BreakdownTable title="macOS vs Linux" rows={m.byOs} />
        <BreakdownTable title="Harness / model" rows={m.byHarness} />
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginBottom: 10 }}>Runner utilization (busy hours vs working hours)</h2>
        {m.runnerUtilization.length === 0 ? <div className="faint">No runner activity yet.</div> : null}
        <div className="stack">
          {m.runnerUtilization.map((u) => (
            <div key={u.runnerId}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>{u.name}</span>
                <span className="dim">
                  {u.busyHours.toFixed(1)}h · {pct(u.utilization)}
                </span>
              </div>
              <div className="meter">
                <span style={{ width: `${Math.round(u.utilization * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
