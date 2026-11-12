import { type Job, jobs, type Repo, repos, runners } from "@foundry/db";
import type { RepoRef } from "@foundry/github";
import { type JobStatus, type LogFields, logged, renderStatusComment, stageLabel } from "@foundry/shared";
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
  reviewing: "In Progress",
  verifying: "In Progress",
  needs_input: "In Review",
  pr_ci: "In Review",
  pr_review: "In Review",
  waiting_on_you: "In Review",
  merged: "Done",
};

const STATUS_NOTES: Partial<Record<JobStatus, string>> = {
  needs_input: "Waiting for an answer to the question below.",
  pr_review: "An agent is reviewing the pull request and its CI results.",
  waiting_on_you: "Handed over for human review. See the pull request for why.",
  failed: "The job stopped. Comment `/foundry retry` or use the panel to retry.",
};

/**
 * Keep the issue in step with the job: one status comment edited in place, exactly one
 * `foundry:<stage>` label, and (optionally) the GitHub Projects Status field.
 */
export async function syncJobToGitHub(ctx: ControlContext, job: Job, from: JobStatus | null): Promise<void> {
  if (job.issueNumber === null) return;
  const issueNumber = job.issueNumber;
  const repo = await logged(
    ctx.log,
    "database read",
    () => ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) }),
    {
      fields: { table: "repos", operation: "findFirst", repoId: job.repoId },
      result: (row) => ({ found: !!row, repo: row?.fullName }),
    },
  );
  if (!repo) return;
  const ref = repoRef(repo);
  const status = job.status as JobStatus;
  const runnerId = job.runnerId;
  const runner = runnerId
    ? await logged(
        ctx.log,
        "database read",
        () => ctx.db.query.runners.findFirst({ where: eq(runners.id, runnerId) }),
        {
          fields: { table: "runners", operation: "findFirst", runnerId },
          result: (row) => ({ found: !!row, runner: row?.name }),
        },
      )
    : null;
  /** One external GitHub call, logged with the shared aspect. */
  const api = <T>(
    operation: string,
    fn: () => PromiseLike<T> | T,
    opts: { result?: (value: T) => LogFields } = {},
  ) =>
    logged(ctx.log, "github api call", fn, {
      fields: { provider: "github", operation, repo: repo.fullName },
      ...opts,
    });
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
    const statusCommentId = job.statusCommentId;
    await api("updateComment", () => ctx.gh.updateComment(ref, statusCommentId, body));
  } else {
    const comment = await api("createComment", () => ctx.gh.createComment(ref, issueNumber, body), {
      result: (comment) => ({ commentId: comment.id }),
    });
    await logged(
      ctx.log,
      "database write",
      () => ctx.db.update(jobs).set({ statusCommentId: comment.id }).where(eq(jobs.id, job.id)),
      { fields: { table: "jobs", operation: "update", jobId: job.id, field: "statusCommentId" } },
    );
  }
  if (from && from !== status)
    await api("removeLabel", () => ctx.gh.removeLabel(ref, issueNumber, stageLabel(from)));
  await api("addLabels", () => ctx.gh.addLabels(ref, issueNumber, [stageLabel(status)]));

  const projectStatus = PROJECT_STATUS[status];
  if (repo.ghProjectId && projectStatus && (!from || PROJECT_STATUS[from] !== projectStatus)) {
    const projectId = repo.ghProjectId;
    await bestEffort(ctx, "project sync", async () => {
      const issue = await api("getIssue", () => ctx.gh.getIssue(ref, issueNumber), {
        result: (issue) => ({ issue: issue.number }),
      });
      await api("setProjectStatus", () =>
        ctx.gh.setProjectStatus(repo.ghInstallationId, projectId, issue.nodeId, projectStatus),
      );
    });
  }
}
