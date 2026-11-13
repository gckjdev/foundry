import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Skill names declared by `<root>/<dir>/SKILL.md`, sorted by directory. The frontmatter `name`
 * wins because that is what the harness registers as the tool name; a directory without one falls
 * back to the directory name.
 */
export async function readSkillNames(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try {
      const text = await readFile(join(root, entry.name, "SKILL.md"), "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
      const declared = frontmatter ? /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(frontmatter)?.[1] : null;
      names.push(declared?.trim() || entry.name);
    } catch {
      // Not a skill directory; ignore it.
    }
  }
  return names;
}
