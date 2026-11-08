import { jobDetail, repoPolicy } from "@foundry/control";
import Link from "next/link";
import { notFound } from "next/navigation";
import { usd } from "@/components/status";
import { requireTeam } from "@/server/session";
import { jobLimitsAction } from "../../../../actions";
import { jobLimitValues } from "./limits";

export default async function JobConfigurationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, team } = await requireTeam();
  const d = await jobDetail(ctx, team.id, id).catch(() => null);
  if (!d) notFound();
  const { job, repo } = d;
  const policy = repoPolicy(repo);
  const policyMaxMinutes = policy.max_job_minutes;
  const policyMaxCost = policy.max_cost_per_job_usd;
  const { maxJobMinutes, maxCostUsd, limitsKey } = jobLimitValues(job, policy);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{repo.fullName} · job configuration</div>
          <h1>{job.title}</h1>
        </div>
        <Link className="button" href={`/jobs/${job.id}`} style={{ whiteSpace: "nowrap" }}>
          ← Back to job
        </Link>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card">
          <h2 style={{ marginBottom: 10 }}>Job limits</h2>
          <form key={limitsKey} action={jobLimitsAction} className="stack">
            <input type="hidden" name="jobId" value={job.id} />
            <label>
              Max execution time (minutes)
              <input name="maxMinutes" type="number" min="1" step="1" defaultValue={maxJobMinutes} />
            </label>
            <div className="dim small">
              {job.maxJobMinutes === null
                ? `Using the repo default (${policyMaxMinutes} minutes).`
                : "Custom for this job."}{" "}
              The runner stops the job when it runs over. Changes apply to a running job too.
            </div>
            <label>
              Max cost (USD)
              <input name="maxCost" type="number" min="0.01" step="0.01" defaultValue={maxCostUsd} />
            </label>
            <div className="dim small">
              {job.maxCostUsd === null
                ? `Using the repo default (${usd(policyMaxCost)}).`
                : "Custom for this job."}{" "}
              The runner stops the job when it spends more. Changes apply to a running job too.
            </div>
            <div>
              <button type="submit">Save</button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
