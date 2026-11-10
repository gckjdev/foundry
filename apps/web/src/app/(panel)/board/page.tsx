import { boardJobs } from "@foundry/control";
import { type JobStatus, RUNNING_STATUSES, STATUS_TITLES } from "@foundry/shared";
import Link from "next/link";
import { ago, usd } from "@/components/status";
import { requireTeam } from "@/server/session";

const LANES: { title: string; statuses: JobStatus[]; hot?: boolean }[] = [
  { title: "Queued", statuses: ["queued"] },
  {
    title: "Working",
    statuses: ["triage", "investigating", "implementing", "reviewing", "verifying"],
    hot: true,
  },
  { title: "Needs input", statuses: ["needs_input"] },
  { title: "PR / CI", statuses: ["pr_ci"] },
  { title: "Waiting on you", statuses: ["waiting_on_you"] },
  { title: "Done", statuses: ["merged"] },
  { title: "Stopped", statuses: ["failed", "cancelled"] },
];

export default async function Board() {
  const { ctx, team } = await requireTeam();
  const rows = await boardJobs(ctx, team.id);
  const live = rows.filter((r) => RUNNING_STATUSES.includes(r.job.status as JobStatus)).length;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{team.name}</div>
          <h1>Board</h1>
        </div>
        <div className="dim">
          {live} running · {rows.filter((r) => r.job.status === "queued").length} queued
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="notice">
          No jobs yet. Label a GitHub issue <code>foundry</code> in an onboarded repo to start one.
        </div>
      ) : (
        <div className="board">
          {LANES.map((lane) => {
            const items = rows.filter((r) => lane.statuses.includes(r.job.status as JobStatus));
            return (
              <section key={lane.title} className="lane" data-hot={lane.hot && items.length > 0}>
                <div className="lane-head">
                  <span>{lane.title}</span>
                  <span>{items.length}</span>
                </div>
                <div className="lane-body">
                  {items.map(({ job, repoFullName, runnerName, waitingReason }) => (
                    <Link
                      key={job.id}
                      href={`/jobs/${job.id}`}
                      className="ticket"
                      data-live={RUNNING_STATUSES.includes(job.status as JobStatus)}
                    >
                      <div className="ticket-title">{job.title}</div>
                      <div className="ticket-meta">
                        <span>
                          {repoFullName.split("/")[1]}
                          {job.issueNumber ? `#${job.issueNumber}` : ""}
                        </span>
                        <span>{usd(job.costUsd)}</span>
                      </div>
                      <div className="ticket-meta">
                        <span>
                          {lane.statuses.length > 1
                            ? STATUS_TITLES[job.status as JobStatus]
                            : (runnerName ?? job.harness)}
                        </span>
                        <span>{ago(job.updatedAt)}</span>
                      </div>
                      {waitingReason ? <div className="waiting">⏸ {waitingReason}</div> : null}
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
