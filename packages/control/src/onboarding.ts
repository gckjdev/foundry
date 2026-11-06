import { randomUUID } from "node:crypto";
import { type Job, jobs, repos, teams } from "@foundry/db";
import { and, eq, notInArray } from "drizzle-orm";
import type { ControlContext } from "./context";
import { NotFoundError, recordEvents, transitionJob } from "./jobs";
import { openPullRequest } from "./prs";

export const ONBOARDING_BRANCH_PREFIX = "foundry/onboarding";

/**
 * Onboarding (spec 5.6): an agent job that writes `.foundry/recipe.yaml`, `policy.yaml` and the
 * issue form, proves every recipe command works on the runner, then opens the recipe PR.
 */
export async function startOnboarding(ctx: ControlContext, repoId: string, byLogin: string): Promise<Job> {
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo) throw new NotFoundError("repo not found");
  const active = await ctx.db.query.jobs.findFirst({
    where: and(eq(jobs.repoId, repoId), eq(jobs.kind, "onboarding"), notInArray(jobs.status, ["merged", "cancelled", "failed"])),
  });
  if (active) return active;
  const team = await ctx.db.query.teams.findFirst({ where: eq(teams.id, repo.teamId) });
  const id = randomUUID();
  const [job] = await ctx.db
    .insert(jobs)
    .values({
      id,
      teamId: repo.teamId,
      repoId,
      kind: "onboarding",
      source: "panel",
      title: `Set up Foundry for ${repo.fullName}`,
      body: "Write .foundry/recipe.yaml, .foundry/policy.yaml and .github/ISSUE_TEMPLATE/foundry.yml for this repo.",
      authorLogin: byLogin,
      harness: repo.defaultHarness ?? team?.defaultHarness ?? "claude-code",
      model: repo.defaultModel ?? team?.defaultModel ?? null,
      playbook: "onboarding",
      branch: `${ONBOARDING_BRANCH_PREFIX}-${id.slice(0, 8)}`,
    })
    .returning();
  await ctx.db.update(repos).set({ onboardingStatus: "running" }).where(eq(repos.id, repoId));
  await recordEvents(ctx, job!, [{ kind: "stage_changed", from: null, to: "queued", reason: `onboarding started by @${byLogin}` }]);
  return job!;
}

export async function completeOnboarding(
  ctx: ControlContext,
  job: Job,
  result: { ok: boolean; reason: string | null; headSha: string | null; summary: string },
) {
  if (!result.ok || !result.headSha) {
    await ctx.db.update(repos).set({ onboardingStatus: "failed" }).where(eq(repos.id, job.repoId));
    await transitionJob(ctx, job.id, "failed", {
      reason: result.reason ?? "onboarding failed",
      patch: { failureReason: result.reason ?? "onboarding failed" },
    });
    return null;
  }
  if (job.status !== "verifying") {
    await transitionJob(ctx, job.id, "verifying", { reason: "recipe commands verified" });
  }
  const fresh = (await ctx.db.query.jobs.findFirst({ where: eq(jobs.id, job.id) }))!;
  const pr = await openPullRequest(ctx, fresh, {
    title: "Set up Foundry",
    summary: result.summary,
    headSha: result.headSha,
    uiChanged: false,
    changedLines: 0,
  });
  await ctx.db.update(repos).set({ onboardingStatus: "pr_open" }).where(eq(repos.id, job.repoId));
  return pr;
}
