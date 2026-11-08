import { inbox } from "@foundry/control";
import type { Job } from "@foundry/db";
import Link from "next/link";
import { ago, StatusPill } from "@/components/status";
import { requireTeam } from "@/server/session";

function JobRow({ job, note }: { job: Job; note?: string }) {
  return (
    <tr>
      <td>
        <Link href={`/jobs/${job.id}`}>{job.title}</Link>
        {note ? <div className="small dim">{note}</div> : null}
      </td>
      <td>
        <StatusPill status={job.status} />
      </td>
      <td className="faint">{ago(job.updatedAt)}</td>
    </tr>
  );
}

function Section({
  title,
  empty,
  children,
  count,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
  count: number;
}) {
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <h2>{title}</h2>
        <span className="faint">{count}</span>
      </div>
      {count === 0 ? (
        <div className="faint">{empty}</div>
      ) : (
        <table>
          <tbody>{children}</tbody>
        </table>
      )}
    </section>
  );
}

export default async function Inbox() {
  const { ctx, team, user } = await requireTeam();
  const box = await inbox(ctx, team.id, user.id);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">@{user.login}</div>
          <h1>Inbox</h1>
        </div>
      </div>
      <div className="grid grid-2">
        <Section title="Questions for you" empty="Nothing to answer." count={box.questions.length}>
          {box.questions.map(({ question, job }) => (
            <JobRow key={question.id} job={job} note={question.prompt} />
          ))}
        </Section>
        <Section title="Handed to you" empty="No PRs waiting on your review." count={box.reviews.length}>
          {box.reviews.map((job) => (
            <JobRow key={job.id} job={job} note={job.prUrl ?? undefined} />
          ))}
        </Section>
        <Section
          title="Unassigned handovers"
          empty="Every handover has a reviewer."
          count={box.unassigned.length}
        >
          {box.unassigned.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </Section>
        <Section
          title="Blocked — no capacity"
          empty="No jobs waiting on a runner."
          count={box.blocked.length}
        >
          {box.blocked.map(({ job, reason }) => (
            <JobRow key={job.id} job={job} note={reason} />
          ))}
        </Section>
        <Section title="Your tickets in flight" empty="You have no open tickets." count={box.mine.length}>
          {box.mine.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </Section>
      </div>
    </>
  );
}
