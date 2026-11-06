import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoPlaybookFiles } from "@foundry/playbooks";
import { DEFAULT_POLICY, parsePolicyYaml, parseRecipeYaml, type Policy, type Recipe } from "@foundry/shared";

export const RECIPE_FILE = ".foundry/recipe.yaml";
export const POLICY_FILE = ".foundry/policy.yaml";

async function read(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function loadRecipe(cwd: string): Promise<{ recipe: Recipe | null; error: string | null }> {
  const text = await read(join(cwd, RECIPE_FILE));
  if (text === null) return { recipe: null, error: `${RECIPE_FILE} is missing` };
  try {
    return { recipe: parseRecipeYaml(text), error: null };
  } catch (err) {
    return { recipe: null, error: `${RECIPE_FILE} is invalid: ${String(err)}` };
  }
}

export async function loadPolicy(cwd: string): Promise<Policy> {
  const text = await read(join(cwd, POLICY_FILE));
  if (text === null) return DEFAULT_POLICY;
  try {
    return parsePolicyYaml(text);
  } catch {
    return DEFAULT_POLICY;
  }
}

/** `.foundry/playbook*.md` and `.foundry/skills/*.md` from the worktree. */
export async function loadPlaybookFiles(cwd: string, names: string[]): Promise<RepoPlaybookFiles> {
  const files: RepoPlaybookFiles = { named: {}, skills: [] };
  const base = await read(join(cwd, ".foundry/playbook.md"));
  if (base) files.playbook = base;
  for (const name of names) {
    const text = await read(join(cwd, `.foundry/playbook.${name}.md`));
    if (text) files.named![name] = text;
  }
  try {
    for (const f of (await readdir(join(cwd, ".foundry/skills"))).filter((f) => f.endsWith(".md")).sort()) {
      const content = await read(join(cwd, ".foundry/skills", f));
      if (content) files.skills!.push({ name: f.slice(0, -3), content });
    }
  } catch {}
  return files;
}
