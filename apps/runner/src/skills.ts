import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BUILTIN_SKILLS, PLAYBOOK_SKILLS } from "@foundry/playbooks";

/** Harness skill folders a repo can carry. Both use `<dir>/<skill>/SKILL.md`. */
export const SKILL_DIRS = [".claude/skills", ".opencode/skills"] as const;

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
export async function installSkills(
  cwd: string,
  names: readonly string[] = PLAYBOOK_SKILLS,
): Promise<InstalledSkill[]> {
  const unknown = names.filter((name) => !BUILTIN_SKILLS[name]);
  if (unknown.length) {
    throw new Error(
      `unknown skill${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")} (known: ${Object.keys(BUILTIN_SKILLS).join(", ")})`,
    );
  }
  const installed: InstalledSkill[] = [];
  for (const name of names) {
    const relativePath = join(name, "SKILL.md");
    const paths: string[] = [];
    for (const dir of SKILL_DIRS) {
      const file = join(cwd, dir, relativePath);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, BUILTIN_SKILLS[name]!, "utf8");
      paths.push(join(dir, relativePath));
    }
    installed.push({ name, paths });
  }
  return installed;
}
