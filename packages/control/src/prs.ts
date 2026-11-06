import { type Job, jobs, repos } from "@foundry/db";
import { renderPrBody } from "@foundry/shared";
import { eq } from "drizzle-orm";
import { artifactUrl } from "./artifacts";
import { type ControlContext, jobUrl } from "./context";
import { repoRef } from "./github-sync";
import { recordEvents, transitionJob } from "./jobs";
import { evaluateJobGate, latestEvidence } from "./merge-gate";

export interface OpenPrInput {
  title: string;
  summary: string;
  headSha: string;
  uiChanged: boolean;
  changedLines: number;
}

/**
 * Open (or refresh) the job's PR after verify. The runner has already pushed the branch with an
 * installation token; the control plane owns the PR so its body, reviewers and merge stay consistent.
 */
export async function openPullRequest(ctx: ControlContext, job: Job, input: OpenPrInput) {
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (!repo) throw new Error("repo not found");
  const ref = repoRef(repo);
  const ev = await latestEvidence(ctx, job);
  const confidence = job.confidence as { level: string; reasons: string[]; uncertainties: string[] } | null;
  const body = renderPrBody({
    issueNumber: job.issueNumber,
    summary: input.summary,
    plan: job.plan,
    evidence: ev.filter((e) => e.kind === "check").map((e) => ({ name: e.name, status: e.status, command: e.command })),
    confidence,
    jobUrl: jobUrl(ctx, job.id),
    screenshots: ev
      .filter((e) => e.kind === "screenshot" && e.artifactId)
      .map((e) => ({ name: e.name, url: artifactUrl(ctx, e.artifactId!) })),
  });
  const existing = job.prNumber ? await ctx.gh.getPullRequest(ref, job.prNumber) : await ctx.gh.findPullRequest(ref, job.branch);
  let pr = existing && existing.state === "open" ? existing : null;
  if (pr) {
    await ctx.gh.updatePullRequest(ref, pr.number, { title: input.title, body });
  } else {
    pr = await ctx.gh.createPullRequest(ref, { head: job.branch, base: repo.defaultBranch, title: input.title, body });
  }
  await ctx.db
    .update(jobs)
    .set({
      prNumber: pr.number,
      prUrl: pr.url,
      prTitle: input.title,
      headSha: input.headSha,
      uiChanged: input.uiChanged,
      changedLines: input.changedLines,
    })
    .where(eq(jobs.id, job.id));
  await recordEvents(ctx, job, [{ kind: "message", role: "system", text: `Pull request ${pr.url}` }]);
  await transitionJob(ctx, job.id, "pr_ci", { reason: "pull request opened", from: ["verifying"] });
  await evaluateJobGate(ctx, job.id);
  return { prNumber: pr.number, url: pr.url };
}
