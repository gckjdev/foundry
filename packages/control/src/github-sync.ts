import { type Job, jobs, type Repo, repos, runners } from "@foundry/db";
import type { RepoRef } from "@foundry/github";
import { type JobStatus, renderStatusComment, stageLabel } from "@foundry/shared";
import { eq } from "drizzle-orm";
import { bestEffort, type ControlContext, jobUrl } from "./context";

export function repoRef(repo: Pick<Repo, "ghInstallationId" | "fullName">): RepoRef {
  return { installationId: repo.ghInstallationId, fullName: repo.fullName };
}

/** GitHub Projects "Status" option for each job status; unmapped statuses leave the field alone. */
export const PROJECT_STATUS: Partial<Record<JobStatus, string>> = {
  queued: "Todo",
  triage: "In Progress",
  investigating: "In Progress",
  implementing: "In Progress",
  verifying: "In Progress",
  needs_input: "In Review",
  pr_ci: "In Review",
  waiting_on_you: "In Review",
  merged: "Done",
};

const STATUS_NOTES: Partial<Record<JobStatus, string>> = {
  needs_input: "Waiting for an answer to the question below.",
  waiting_on_you: "Handed over for human review. See the pull request for why.",
  failed: "The job stopped. Comment `/foundry retry` or use the panel to retry.",
};

/**
 * Keep the issue in step with the job: one status comment edited in place, exactly one
 * `foundry:<stage>` label, and (optionally) the GitHub Projects Status field.
 */
export async function syncJobToGitHub(ctx: ControlContext, job: Job, from: JobStatus | null): Promise<void> {
  if (job.issueNumber === null) return;
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (!repo) return;
  const ref = repoRef(repo);
  const status = job.status as JobStatus;
  const runner = job.runnerId
    ? await ctx.db.query.runners.findFirst({ where: eq(runners.id, job.runnerId) })
    : null;
  const body = renderStatusComment({
    jobId: job.id,
    status,
    runnerName: runner?.name ?? null,
    costUsd: job.costUsd,
    jobUrl: jobUrl(ctx, job.id),
    prUrl: job.prUrl,
    note:
      job.failureReason && status === "failed"
        ? `Reason: ${job.failureReason}`
        : (STATUS_NOTES[status] ?? null),
  });
  if (job.statusCommentId) {
    await ctx.gh.updateComment(ref, job.statusCommentId, body);
  } else {
    const comment = await ctx.gh.createComment(ref, job.issueNumber, body);
    await ctx.db.update(jobs).set({ statusCommentId: comment.id }).where(eq(jobs.id, job.id));
  }
  if (from && from !== status) await ctx.gh.removeLabel(ref, job.issueNumber, stageLabel(from));
  await ctx.gh.addLabels(ref, job.issueNumber, [stageLabel(status)]);

  const projectStatus = PROJECT_STATUS[status];
  if (repo.ghProjectId && projectStatus && (!from || PROJECT_STATUS[from] !== projectStatus)) {
    const projectId = repo.ghProjectId;
    const issueNumber = job.issueNumber;
    await bestEffort(ctx, "project sync", async () => {
      const issue = await ctx.gh.getIssue(ref, issueNumber);
      await ctx.gh.setProjectStatus(repo.ghInstallationId, projectId, issue.nodeId, projectStatus);
    });
  }
}
