import { type Repo, repos } from "@foundry/db";
import {
  DEFAULT_POLICY,
  type MergeMode,
  type Policy,
  parsePolicyYaml,
  parseRecipeYaml,
  type Recipe,
} from "@foundry/shared";
import { eq } from "drizzle-orm";
import type { ControlContext } from "./context";
import { repoRef } from "./github-sync";

export const RECIPE_PATH = ".foundry/recipe.yaml";
export const POLICY_PATH = ".foundry/policy.yaml";

/** Re-read `.foundry/` from the default branch. A repo accepts jobs once a valid recipe exists. */
export async function refreshRepoConfig(ctx: ControlContext, repo: Repo): Promise<Repo> {
  const ref = repoRef(repo);
  const [recipe, policy] = await Promise.all([
    ctx.gh.getFile(ref, RECIPE_PATH, repo.defaultBranch),
    ctx.gh.getFile(ref, POLICY_PATH, repo.defaultBranch),
  ]);
  let valid = false;
  if (recipe) {
    try {
      parseRecipeYaml(recipe.content);
      valid = true;
    } catch (err) {
      ctx.log("invalid recipe.yaml", { repo: repo.fullName, error: String(err) });
    }
  }
  const [updated] = await ctx.db
    .update(repos)
    .set({
      recipeSha: recipe?.sha ?? null,
      recipeYaml: recipe?.content ?? null,
      policyYaml: policy?.content ?? null,
      acceptsJobs: valid,
      onboardingStatus: valid ? "done" : repo.onboardingStatus === "done" ? "not_started" : repo.onboardingStatus,
    })
    .where(eq(repos.id, repo.id))
    .returning();
  return updated!;
}

export function repoRecipe(repo: Pick<Repo, "recipeYaml">): Recipe | null {
  if (!repo.recipeYaml) return null;
  try {
    return parseRecipeYaml(repo.recipeYaml);
  } catch {
    return null;
  }
}

export function repoPolicy(repo: Pick<Repo, "policyYaml">): Policy {
  if (!repo.policyYaml) return DEFAULT_POLICY;
  try {
    return parsePolicyYaml(repo.policyYaml);
  } catch {
    return DEFAULT_POLICY;
  }
}

/** The panel setting wins when it enables merging; otherwise policy.yaml decides. */
export function effectiveMergeMode(repo: Pick<Repo, "mergeMode" | "policyYaml">): MergeMode {
  if (repo.mergeMode === "merge_when_confident") return "merge_when_confident";
  return repoPolicy(repo).merge;
}

export async function updateRepoSettings(
  ctx: ControlContext,
  repoId: string,
  patch: Partial<Pick<Repo, "mergeMode" | "defaultHarness" | "defaultModel" | "ghProjectId">>,
) {
  const [row] = await ctx.db.update(repos).set(patch).where(eq(repos.id, repoId)).returning();
  return row;
}
