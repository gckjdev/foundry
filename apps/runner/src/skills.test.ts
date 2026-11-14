import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_SKILL_ASSETS, BUILTIN_SKILLS, PLAYBOOK_SKILLS } from "@foundry/playbooks";
import { describe, expect, it } from "vitest";
import { installedSkillNames, installSkills, SKILL_DIRS } from "./skills";

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
    // Companion files (e.g. harness-log's script) are written next to the SKILL.md.
    for (const dir of SKILL_DIRS) {
      for (const name of PLAYBOOK_SKILLS) {
        for (const asset of BUILTIN_SKILL_ASSETS[name] ?? []) {
          const file = join(cwd, dir, name, asset.path);
          expect(existsSync(file)).toBe(true);
          expect(readFileSync(file, "utf8")).toBe(asset.content);
        }
      }
    }
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

describe("installedSkillNames", () => {
  it("reads only .claude/skills for Claude Code and both folders for OpenCode", async () => {
    const cwd = tempRepo();
    mkdirSync(join(cwd, ".claude/skills/code-review"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude/skills/code-review/SKILL.md"),
      "---\nname: code-review\n---\n\n# Code review\n",
    );
    mkdirSync(join(cwd, ".opencode/skills/merge-risk"), { recursive: true });
    writeFileSync(
      join(cwd, ".opencode/skills/merge-risk/SKILL.md"),
      "---\nname: merge-risk\n---\n\n# Merge risk\n",
    );

    expect(await installedSkillNames(cwd, "claude-code")).toEqual(["code-review"]);
    expect((await installedSkillNames(cwd, "opencode")).sort()).toEqual(["code-review", "merge-risk"]);
  });

  it("returns an empty list when nothing is installed", async () => {
    expect(await installedSkillNames(tempRepo(), "claude-code")).toEqual([]);
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
        for (const asset of BUILTIN_SKILL_ASSETS[name] ?? []) {
          const assetFile = join(REPO_ROOT, dir, name, asset.path);
          expect(readFileSync(assetFile, "utf8"), `${dir}/${name}/${asset.path} is stale`).toBe(
            asset.content,
          );
        }
      }
    }
  });
});
