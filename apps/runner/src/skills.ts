import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { skillFiles } from "@foundry/playbooks";

export { SKILL_DIRS } from "@foundry/playbooks";

export interface InstalledSkill {
  name: string;
  /** Worktree-relative paths written. */
  paths: string[];
}

/**
 * Copy built-in playbook skills into the repo's harness skill folders so an agent can load them
 * natively. Called by onboarding (the recipe PR carries the files) and by `foundry skills install`.
 * Re-running overwrites the files, so it doubles as an update.
 */
export async function installSkills(cwd: string, names?: readonly string[]): Promise<InstalledSkill[]> {
  const files = skillFiles(names);
  for (const file of files) {
    const target = join(cwd, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  const pathsByName = new Map<string, string[]>();
  for (const file of files) {
    const paths = pathsByName.get(file.name) ?? [];
    paths.push(file.path);
    pathsByName.set(file.name, paths);
  }
  return [...pathsByName].map(([name, paths]) => ({ name, paths }));
}
