import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_SKILLS, PLAYBOOK_SKILLS } from "@foundry/playbooks";
import { describe, expect, it } from "vitest";
import { installSkills, SKILL_DIRS } from "./skills";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "foundry-skills-"));
}

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
        expect(content).toBe(BUILTIN_SKILLS[name]);
      }
    }
    expect(installed[0]!.paths).toEqual(SKILL_DIRS.map((dir) => join(dir, PLAYBOOK_SKILLS[0], "SKILL.md")));
  });

  it("installs only the named skills", async () => {
    const cwd = tempRepo();
    const installed = await installSkills(cwd, ["show-me"]);
    expect(installed).toHaveLength(1);
    expect(existsSync(join(cwd, ".claude/skills/show-me/SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude/skills/merge-risk"))).toBe(false);
    expect(existsSync(join(cwd, ".claude/skills/code-review"))).toBe(false);
  });

  it("rejects an unknown skill name before writing anything", async () => {
    const cwd = tempRepo();
    await expect(installSkills(cwd, ["merge-risk", "nope"])).rejects.toThrow(/unknown skill: nope/);
    expect(existsSync(join(cwd, ".claude/skills"))).toBe(false);
  });
});

describe("checked-in skill copies", () => {
  // Foundry dogfoods its own skills: the repo carries what onboarding would install, so a change to
  // a built-in skill must be followed by `foundry skills install`.
  it("match BUILTIN_SKILLS in both harness folders", () => {
    for (const dir of SKILL_DIRS) {
      for (const name of PLAYBOOK_SKILLS) {
        const file = join(REPO_ROOT, dir, name, "SKILL.md");
        expect(readFileSync(file, "utf8"), `${dir}/${name}/SKILL.md is stale`).toBe(BUILTIN_SKILLS[name]);
      }
    }
  });
});
