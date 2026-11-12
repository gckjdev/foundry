import { repos } from "@foundry/db";
import type { GhPullRequest } from "@foundry/github";
import { skillFiles } from "@foundry/playbooks";
import { eq } from "drizzle-orm";
import type { ControlContext } from "./context";
import { repoRef } from "./github-sync";
import { NotFoundError } from "./jobs";

/** The one branch a repo's skills PR lives on, so a later sync updates it instead of piling up PRs. */
export const SKILLS_BRANCH = "foundry/skills";

export interface SkillsSync {
  prNumber: number;
  url: string;
  skills: string[];
  /** True when an open skills PR already existed and was updated in place. */
  updated: boolean;
}

/**
 * Install or update the built-in playbook skills in a repo by opening a pull request. Reuses the
 * open `foundry/skills` PR when there is one; otherwise resets the branch to the default branch
 * (a stale merged branch) and opens a fresh PR. Overwriting the files is the update path.
 */
export async function syncRepoSKills(ctx: ControlContext, repoId: string): Promise<SkillsSync> {
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!repo) throw new NotFoundError("repo not found");
  const ref = repoRef(repo);
  const files = skillFiles();
  const skills = [...new Set(files.map((file) => file.name))];

  const existing = await ctx.gh.findPullRequest(ref, SKILLS_BRANCH);
  const reuse = existing?.state === "open";
  if (!reuse) {
    const baseSha = await ctx.gh.getBranchSha(ref, repo.defaultBranch);
    if (!baseSha) throw new Error(`default branch ${repo.defaultBranch} not found`);
    const stale = await ctx.gh.getBranchSha(ref, SKILLS_BRANCH);
    await ctx.gh.createBranch(ref, SKILLS_BRANCH, baseSha, stale !== null);
  }
  for (const file of files) {
    await ctx.gh.putFile(ref, {
      path: file.path,
      content: file.content,
      message: `foundry: install skill ${file.name}`,
      branch: SKILLS_BRANCH,
    });
  }

  const title = "Install Foundry skills";
  const body = [
    "Installs Foundry's built-in playbook skills so Claude Code and OpenCode load them natively.",
    "",
    ...files.map((file) => `- \`${file.path}\``),
    "",
    "Re-run **Install / sync skills** from the Repos page to update these files.",
  ].join("\n");

  let pr: GhPullRequest;
  if (reuse && existing) {
    await ctx.gh.updatePullRequest(ref, existing.number, { title, body });
    pr = existing;
  } else {
    pr = await ctx.gh.createPullRequest(ref, {
      head: SKILLS_BRANCH,
      base: repo.defaultBranch,
      title,
      body,
    });
  }
  ctx.log.info("repo skills synced", { repo: repo.fullName, pr: pr.number, updated: reuse });
  return { prNumber: pr.number, url: pr.url, skills, updated: reuse };
}
