import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLAYBOOK_SKILLS } from "@foundry/playbooks";
import { describe, expect, it } from "vitest";
import { installSkills, SKILL_DIRS } from "./skills";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "foundry-skills-"));
}

const HEADINGS: Record<string, string> = {
  "merge-risk": "# Merge risk",
  "resolve-merge-conflicts": "# Resolve merge conflicts",
};

describe("installSkills", () => {
  it("copies the playbook skills into both harness folders", async () => {
    const cwd = tempRepo();
    const installed = await installSkills(cwd);
    expect(installed.map((s) => s.name)).toEqual([...PLAYBOOK_SKILLS]);
    for (const dir of SKILL_DIRS) {
      for (const name of PLAYBOOK_SKILLS) {
        const file = join(cwd, dir, name, "SKILL.md");
        expect(existsSync(file)).toBe(true);
        const content = readFileSync(file, "utf8");
        expect(content).toContain(`name: ${name}`);
        expect(content).toContain(HEADINGS[name]!);
      }
    }
    expect(installed[0]!.paths).toEqual(SKILL_DIRS.map((dir) => join(dir, "merge-risk", "SKILL.md")));
  });

  it("installs only the named skills", async () => {
    const cwd = tempRepo();
    const installed = await installSkills(cwd, ["merge-risk"]);
    expect(installed).toHaveLength(1);
    expect(existsSync(join(cwd, ".claude/skills/merge-risk/SKILL.md"))).toBe(true);
  });

  it("rejects an unknown skill name before writing anything", async () => {
    const cwd = tempRepo();
    await expect(installSkills(cwd, ["merge-risk", "nope"])).rejects.toThrow(/unknown skill: nope/);
    expect(existsSync(join(cwd, ".claude/skills"))).toBe(false);
  });
});
