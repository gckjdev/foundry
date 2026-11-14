import { jobDetail, repoPolicy } from "@foundry/control";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeam } from "@/server/session";
import { JobLimitsForm } from "./job-limits-form";
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
          <JobLimitsForm
            jobId={job.id}
            limitsKey={limitsKey}
            maxJobMinutes={maxJobMinutes}
            maxCostUsd={maxCostUsd}
            customMaxMinutes={job.maxJobMinutes !== null}
            customMaxCost={job.maxCostUsd !== null}
            policyMaxMinutes={policyMaxMinutes}
            policyMaxCost={policyMaxCost}
          />
        </section>
      </div>
    </>
  );
}
