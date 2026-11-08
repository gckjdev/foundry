import { capacityCard, runningJobsByRunner, teamRunners } from "@foundry/control";
import { repos, runnerRepoReadiness } from "@foundry/db";
import { type HarnessInfo, isOnline } from "@foundry/shared";
import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { ago } from "@/components/status";
import { requireTeam } from "@/server/session";
import { runnerStatusAction } from "../../actions";
import { JoinToken } from "./join-token";

export default async function Runners() {
  const { ctx, team, role } = await requireTeam();
  const list = await teamRunners(ctx, team.id);
  const now = new Date();
  const ids = list.map((r) => r.id);
  const shared = list.filter((r) => r.kind === "shared");
  // The capacity card only depends on the team, so it overlaps the runner-scoped queries rather
  // than adding a third, sequential round trip to the page.
  const [running, readiness, capacity] = await Promise.all([
    runningJobsByRunner(ctx, ids),
    ids.length
      ? ctx.db
          .select({ r: runnerRepoReadiness, fullName: repos.fullName, repoSha: repos.recipeSha })
          .from(runnerRepoReadiness)
          .innerJoin(repos, eq(repos.id, runnerRepoReadiness.repoId))
          .where(inArray(runnerRepoReadiness.runnerId, ids))
      : Promise.resolve([]),
    shared.length === 0 && list.length > 0 ? capacityCard(ctx, team.id) : Promise.resolve(null),
  ]);
  const online = list.filter((r) => isOnline(r, now));
  const slots = online.reduce((n, r) => n + (r.accepting && r.status === "active" ? r.maxConcurrency : 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{team.name}</div>
          <h1>Runners</h1>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="stat">{online.length}</div>
          <div className="stat-label">online of {list.length}</div>
        </div>
        <div className="card">
          <div className="stat">{running.length}</div>
          <div className="stat-label">jobs running</div>
        </div>
        <div className="card">
          <div className="stat">{Math.max(0, slots - running.length)}</div>
          <div className="stat-label">free slots now</div>
        </div>
        <div className="card">
          <div className="stat">{shared.length}</div>
          <div className="stat-label">shared machines</div>
        </div>
      </div>
      {capacity ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2 style={{ marginBottom: 8 }}>Laptops-only capacity</h2>
          <div className="grid grid-2">
            <div>
              <div className="stat">{capacity.hoursNoOnlineRunner.toFixed(1)}h</div>
              <div className="stat-label">no runner online this week</div>
            </div>
            <div>
              <div className="stat">{capacity.estimatedHoursSavedBySharedRunner.toFixed(1)}h</div>
              <div className="stat-label">queue time a shared runner would save</div>
            </div>
          </div>
          <p className="dim small" style={{ marginTop: 8 }}>
            Jobs pause when every laptop sleeps and resume on the next one that wakes. A spare Mac mini or
            Linux box as a shared runner would cover those hours.
          </p>
        </section>
      ) : null}

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Runner</th>
              <th>State</th>
              <th>Machine</th>
              <th>Harnesses</th>
              <th>Repos ready</th>
              <th>Running</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const up = isOnline(r, now);
              const jobs = running.filter((j) => j.runnerId === r.id);
              const ready = readiness.filter((x) => x.r.runnerId === r.id);
              return (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    <div className="faint small">
                      {r.kind} · v{r.version ?? "?"}
                    </div>
                  </td>
                  <td>
                    <span
                      className="pill"
                      data-tone={!up ? "bad" : r.status === "draining" ? "warn" : r.accepting ? "ok" : "warn"}
                    >
                      {!up
                        ? "offline"
                        : r.status === "draining"
                          ? "draining"
                          : r.accepting
                            ? "accepting"
                            : "paused"}
                    </span>
                    <div className="faint small">
                      {up ? (r.notAcceptingReason ?? "") : `seen ${ago(r.lastSeenAt)}`}
                    </div>
                  </td>
                  <td className="small">
                    {r.os} {r.arch}
                    <div className="faint">
                      {r.cpu} cpu · {Math.round((r.memMb ?? 0) / 1024)} GB ·{" "}
                      {Math.round((r.diskFreeMb ?? 0) / 1024)} GB free
                      {r.onAcPower === false ? " · on battery" : ""}
                    </div>
                  </td>
                  <td className="small">
                    {(r.harnesses as HarnessInfo[]).map((h) => (
                      <div
                        key={h.id}
                        style={{ color: h.installed && h.authOk ? "var(--text)" : "var(--bad)" }}
                      >
                        {h.id} {h.version ?? ""}{" "}
                        {!h.installed ? "(missing)" : !h.authOk ? "(not signed in)" : ""}
                      </div>
                    ))}
                  </td>
                  <td className="small">
                    {ready.map((x) => (
                      <div
                        key={x.r.repoId}
                        style={{
                          color: x.r.ready && x.r.recipeSha === x.repoSha ? "var(--ok)" : "var(--warn)",
                        }}
                      >
                        {x.fullName.split("/")[1]}{" "}
                        {x.r.ready
                          ? x.r.recipeSha === x.repoSha
                            ? ""
                            : "(stale recipe)"
                          : `✖ ${x.r.reason ?? ""}`}
                      </div>
                    ))}
                  </td>
                  <td className="small">
                    {jobs.map((j) => (
                      <div key={j.id}>
                        <Link href={`/jobs/${j.id}`}>{j.title}</Link>
                      </div>
                    ))}
                    <span className="faint">
                      {jobs.length}/{r.maxConcurrency}
                    </span>
                  </td>
                  <td>
                    {role === "admin" ? (
                      <form action={runnerStatusAction} className="row">
                        <input type="hidden" name="runnerId" value={r.id} />
                        {r.status === "draining" ? (
                          <button name="status" value="active" type="submit">
                            Resume
                          </button>
                        ) : (
                          <button name="status" value="draining" type="submit">
                            Drain
                          </button>
                        )}
                        <button name="status" value="removed" type="submit" className="danger">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 ? <div className="faint">No runners yet. Add one below.</div> : null}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 8 }}>Add a runner</h2>
        <p className="dim">Install the runner on a Mac or Linux machine, then join it to this team:</p>
        <pre className="log">{`# macOS or Linux: install and join in one step
curl -fsSL ${ctx.publicUrl}/install.sh | sh -s -- <token>            # personal (your laptop)
curl -fsSL ${ctx.publicUrl}/install.sh | sh -s -- <token> --shared   # shared machine

# or with Homebrew / apt / dnf, then join
brew install foundry-dev/tap/foundry
foundry runner join <token> --server ${ctx.publicUrl} [--shared]
foundry runner install-service   # start on login (add --system for a boot-time daemon)`}</pre>
        <JoinToken />
      </section>
    </>
  );
}
