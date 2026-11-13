# Handoff brief: Reviewer follows inline skill snapshots instead of invoking the installed Skill tool

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-13T04:42:18.518Z

## Plan

1. `packages/playbooks/src/playbooks/reviewer.md`: replace the two "in this prompt" directives with instructions to invoke the installed Skill tool — `Skill(code-review)` / `Skill(merge-risk)` (harness-agnostic: "the harness skill tool") — reading the live `.claude/skills/<name>/SKILL.md` or `.opencode/skills/<name>/SKILL.md` from the checkout.
2. `packages/playbooks/src/index.ts`: remove the inline `## Skill: code-review` / `## Skill: merge-risk` embedding from `assembleReviewPrompt`; drop the now-unused `skillBody` helper (its only purpose was the embedding).
3. `packages/playbooks/src/playbooks.test.ts`: update the reviewer-prompt test to assert the prompt directs a Skill invocation and no longer contains the embedded rubric/body; rewrite the built-in-skill assertions without `skillBody`; add a regression assertion that fails if embedding returns.
4. Verify with `pnpm exec vitest run packages/playbooks/src/playbooks.test.ts`, `pnpm exec biome check` on touched files, `pnpm --filter @foundry/playbooks typecheck`, then the recipe checks.

## Findings

- triage: Found the embedding in assembleReviewPrompt (packages/playbooks/src/index.ts:141-144) and the "in this prompt" wording in reviewer.md. The claude-code adapter already loads .claude/skills/<name>/SKILL.md via repoSkillNames and passes those names to the SDK, and the OpenCode config points at both .claude/skills and .opencode/skills, so Skill invocation is available for both harnesses when the repo has installed skills. skillBody exists only to support the embedding.
- investigating: Plan recorded: update reviewer.md to invoke the installed skills, remove the inline embedding and dead skillBody helper from index.ts, and update/extend playbooks tests before running checks.
- implementing: Removed the inline code-review/merge-risk embedding from assembleReviewPrompt (and the now-unused skillBody helper), rewrote reviewer.md to invoke the repo's installed skills via the harness skill tool, and updated playbooks tests to assert the Skill directive and absence of embedded bodies. Targeted Vitest, Biome, and playbooks typecheck pass.
- review: Reviewed code quality, UI design and security. The ticket's two changes are implemented correctly: reviewer.md now directs the reviewer to invoke the installed skill through the harness skill tool, and assembleReviewPrompt no longer embeds the code-review/merge-risk bodies; the tests assert the directive and regress if embedding returns. UI design does not apply (no UI files). Security: no secrets, injection or auth surface touched. One blocking gap: removing the embedding also removes the fallback for repos that have not installed the skills, and the prompt has no path for that case.
- implementing: Added the requested fallback: review sessions detect which skills the harness will load from the review checkout (harness-aware: .claude/skills for Claude Code, both folders for OpenCode) and assembleReviewPrompt embeds a built-in body only for a missing code-review or merge-risk skill, with a runner log naming the fallback skills. Refactored skill-name parsing into harness-core so adapter and runner share it, documented the behavior, and covered installed/partial/missing paths in playbooks, runner skills and job-runner tests. Targeted tests, Biome and package typechecks pass.
- review: Reviewed the full diff against the ticket. Code quality: the ticket's core goal is met — `reviewer.md` now directs the reviewer to invoke the installed `Skill(code-review)` / `Skill(merge-risk)`, and `assembleReviewPrompt` takes an `installedSkills` list so repo customizations are what the review runs; the inline body is embedded only as a fallback when the checkout lacks the skill, which is a documented deviation from the ticket's suggested "remove the embedding" step but preserves pre-skill repos. Skill-name parsing was correctly centralized in harness-core (the Claude Code adapter behavior is unchanged), and tests cover installed/partial/missing prompt paths plus harness-specific detection and both integration paths' prompts. UI design: not applicable — no UI files or user-facing panel changes. Security: checked secrets, injection, authorization and dependencies; the change touches prompt assembly and read-only filesystem reads of repo-controlled skill files, with no new attack surface. I could not execute the test suite in this review worktree (dependencies are not installed), so I relied on reading the tests; the implementer reports the targeted tests and package typechecks pass.
- reviewing: The independent reviewer approved the fallback implementation. Moving to recipe checks: lint, typecheck and tests for the playbooks/harness/runner change.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "4f808462-8e01-451b-ae2a-fd33b4aab48c",
  "title": "Reviewer follows inline skill snapshots instead of invoking the installed Skill tool",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "12fe23bd-9cff-4c2b-b01f-034cf239f988",
  "plan": "1. `packages/playbooks/src/playbooks/reviewer.md`: replace the two \"in this prompt\" directives with instructions to invoke the installed Skill tool — `Skill(code-review)` / `Skill(merge-risk)` (harness-agnostic: \"the harness skill tool\") — reading the live `.claude/skills/<name>/SKILL.md` or `.opencode/skills/<name>/SKILL.md` from the checkout.\n2. `packages/playbooks/src/index.ts`: remove the inline `## Skill: code-review` / `## Skill: merge-risk` embedding from `assembleReviewPrompt`; drop the now-unused `skillBody` helper (its only purpose was the embedding).\n3. `packages/playbooks/src/playbooks.test.ts`: update the reviewer-prompt test to assert the prompt directs a Skill invocation and no longer contains the embedded rubric/body; rewrite the built-in-skill assertions without `skillBody`; add a regression assertion that fails if embedding returns.\n4. Verify with `pnpm exec vitest run packages/playbooks/src/playbooks.test.ts`, `pnpm exec biome check` on touched files, `pnpm --filter @foundry/playbooks typecheck`, then the recipe checks.",
  "findings": [
    "triage: Found the embedding in assembleReviewPrompt (packages/playbooks/src/index.ts:141-144) and the \"in this prompt\" wording in reviewer.md. The claude-code adapter already loads .claude/skills/<name>/SKILL.md via repoSkillNames and passes those names to the SDK, and the OpenCode config points at both .claude/skills and .opencode/skills, so Skill invocation is available for both harnesses when the repo has installed skills. skillBody exists only to support the embedding.",
    "investigating: Plan recorded: update reviewer.md to invoke the installed skills, remove the inline embedding and dead skillBody helper from index.ts, and update/extend playbooks tests before running checks.",
    "implementing: Removed the inline code-review/merge-risk embedding from assembleReviewPrompt (and the now-unused skillBody helper), rewrote reviewer.md to invoke the repo's installed skills via the harness skill tool, and updated playbooks tests to assert the Skill directive and absence of embedded bodies. Targeted Vitest, Biome, and playbooks typecheck pass.",
    "review: Reviewed code quality, UI design and security. The ticket's two changes are implemented correctly: reviewer.md now directs the reviewer to invoke the installed skill through the harness skill tool, and assembleReviewPrompt no longer embeds the code-review/merge-risk bodies; the tests assert the directive and regress if embedding returns. UI design does not apply (no UI files). Security: no secrets, injection or auth surface touched. One blocking gap: removing the embedding also removes the fallback for repos that have not installed the skills, and the prompt has no path for that case.",
    "implementing: Added the requested fallback: review sessions detect which skills the harness will load from the review checkout (harness-aware: .claude/skills for Claude Code, both folders for OpenCode) and assembleReviewPrompt embeds a built-in body only for a missing code-review or merge-risk skill, with a runner log naming the fallback skills. Refactored skill-name parsing into harness-core so adapter and runner share it, documented the behavior, and covered installed/partial/missing paths in playbooks, runner skills and job-runner tests. Targeted tests, Biome and package typechecks pass.",
    "review: Reviewed the full diff against the ticket. Code quality: the ticket's core goal is met — `reviewer.md` now directs the reviewer to invoke the installed `Skill(code-review)` / `Skill(merge-risk)`, and `assembleReviewPrompt` takes an `installedSkills` list so repo customizations are what the review runs; the inline body is embedded only as a fallback when the checkout lacks the skill, which is a documented deviation from the ticket's suggested \"remove the embedding\" step but preserves pre-skill repos. Skill-name parsing was correctly centralized in harness-core (the Claude Code adapter behavior is unchanged), and tests cover installed/partial/missing prompt paths plus harness-specific detection and both integration paths' prompts. UI design: not applicable — no UI files or user-facing panel changes. Security: checked secrets, injection, authorization and dependencies; the change touches prompt assembly and read-only filesystem reads of repo-controlled skill files, with no new attack surface. I could not execute the test suite in this review worktree (dependencies are not installed), so I relied on reading the tests; the implementer reports the targeted tests and package typechecks pass.",
    "reviewing: The independent reviewer approved the fallback implementation. Moving to recipe checks: lint, typecheck and tests for the playbooks/harness/runner change."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-13T04:42:18.518Z"
}
```
