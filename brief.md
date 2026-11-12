# Handoff brief: in Auto PR review setup, add merge risk assessment

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-12T08:12:37.246Z

## Plan

1. Add built-in skill registry in `packages/playbooks`: new `src/skills/merge-risk/SKILL.md` (adapted from warpdotdev for Foundry's review tool), `BUILTIN_SKILLS`, `PLAYBOOK_SKILLS`, and a frontmatter-stripping helper. Embed the merge-risk body in `assembleReviewPrompt` and tell `reviewer.md` to report it.
2. Extend review reporting: add required `risk: { level: low|medium|high, summary }` to `ReviewReportSchema` (mcp-foundry) and optional `risk` to `PrReviewRequestSchema` (shared, for API compatibility). Render `**Merge risk: …**` in `renderPrReviewBody`, include it in `formatReview`, runner fallback reports, submitPrReview event/log.
3. Skill onboarding: add `apps/runner/src/skills.ts` (`installSkills` writing `.claude/skills/<name>/SKILL.md` and `.opencode/skills/<name>/SKILL.md`) plus `foundry skills list|install [names...] [--all]` CLI. Call it in `finishOnboarding()` before the onboarding commit so the recipe PR carries the skills.
4. Skill loading: Claude adapter passes `skills: "all"`; OpenCode config passes `skills.paths: [".claude/skills", ".opencode/skills"]`.
5. Tests: skills install/list, playbook prompt includes merge-risk, adapter options include skills, PR review body shows risk, update all review-tool literals in runner/control/e2e/mcp tests. Docs: docs/api.md, docs/foundry-dot-dir.md, docs/onboarding.md.
6. Verify with biome, the affected vitest projects, and repo checks.

## Findings

- triage: Mapped the review pipeline (assembleReviewPrompt, mcp-foundry review tool, PrReviewRequest/renderPrReviewBody, submitPrReview), the runner's onboarding/PR-review flow, and both harness adapters. Verified Claude Agent SDK supports `skills: 'all'` and OpenCode supports `skills.paths`; built-in playbooks live in packages/playbooks, and the runner already installs repo files during onboarding.
- investigating: Plan recorded: ship a merge-risk built-in skill, surface its level+summary in the review report and PR comment, install skills into both harness folders during onboarding and via a CLI, and load repo skills from those folders in both adapters.
- implementing: Implemented merge-risk end to end: a built-in merge-risk skill embedded in the reviewer prompt and installed into `.claude/skills`/`.opencode/skills`; `review` now takes a required `risk {level,summary}` that renders in the GitHub PR review body and job timeline; onboarding installs playbook skills in the recipe PR and `foundry skills install` updates them later; both harnesses load repo skills. Added/updated unit tests and docs; lint, typecheck and tests pass.
- review: The reviewer did not report a verdict.
- implementing: Addressed the prior review round: the recorded blocking finding was the reviewer session failing to call the MCP review tool (its transcript had a complete approve verdict but it repeatedly invoked the host's ReportFindings instead). Hardened the harness: Claude sessions now enable exactly the repo's `.claude/skills` names rather than `skills: "all"` (no user/plugin skill leakage), ReportFindings is disallowed for Foundry sessions, and the reviewer playbook now names `foundry.review`/`mcp__foundry__review` and forbids generic findings tools. Also updated the zh-CN docs to match. Lint, typecheck and tests pass.
- review: Reviewed the full diff against origin/main plus the surrounding code it touches.

Verified locally in the matching sibling checkout (same HEAD, dependencies installed): `pnpm test:unit` (31 files / 237 tests), the affected runner job/daemon tests (26 tests), `tsc` typecheck for @foundry/{shared,playbooks,mcp-foundry,harness-claude-code,harness-opencode,runner}, and `biome check` over the touched packages — all pass. I also confirmed the pinned SDK 0.3.318 does support `options.skills?: string[] | "all"` (so the adapter's filter is real, not dead config), that OpenCode 1.19.5's config schema accepts `skills.paths`, and that Claude Code's SKILL.md frontmatter parser tolerates the leading blank line in the new skill file.

Acceptance criteria:
- Auto PR review risk: satisfied. `ReviewReportSchema` (mcp-foundry) now requires `risk: {level, summary}`; `renderPrReviewBody` renders `**Merge risk: …**` plus reasons; the control plane records it in the review comment body, the timeline message, evidence outputTail, and the log; the runner's `formatReview` and both fallback reports carry it.
- Skill onboarding: satisfied. `installSkills` writes `.claude/skills/<name>/SKILL.md` and `.opencode/skills/<name>/SKILL.md`; onboarding calls it before the recipe commit (covered by a real-git assertion in job-runner.test.ts) and `foundry skills list|install [names] [--all]` covers post-onboarding install/update. Unknown names are validated before any write.
- Skill loading: satisfied. The Claude adapter passes the repo's declared skill names (dismissing user/plugin skills), and OpenCode is pointed at both folders. This also addresses the prior round's blocker: `ReportFindings` is disallowed for Claude sessions and the reviewer playbook explicitly names `foundry.review`/`mcp__foundry__review` and forbids generic findings tools.

One environment note, not a code defect: the review harness that launched *this* session is running pre-branch runner code (the advertised `review` tool schema has no `risk`, and my prompt is the old reviewer text), so I could not exercise the new required field end-to-end here; the code paths and unit tests above do cover it.

UI design: not applicable — no component, page, style or token files changed, and there is no user-facing panel change. Security: checked — no secrets/credentials introduced; skill content is built-in; `installSkills` validates names against the registry so no path traversal; newly native-loaded repo skills are repo-controlled content the agent already reads, and policy command/network restrictions still apply.

No blocking findings. Six non-blocking suggestions are below.
- reviewing: Reviewer approved. Running the recipe checks against the final tree before finishing.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "a118b28a-91be-415f-9db8-f3985649158e",
  "title": "in Auto PR review setup, add merge risk assessment",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "9845f148-91a9-46a1-8f2a-21829e4c7584",
  "plan": "1. Add built-in skill registry in `packages/playbooks`: new `src/skills/merge-risk/SKILL.md` (adapted from warpdotdev for Foundry's review tool), `BUILTIN_SKILLS`, `PLAYBOOK_SKILLS`, and a frontmatter-stripping helper. Embed the merge-risk body in `assembleReviewPrompt` and tell `reviewer.md` to report it.\n2. Extend review reporting: add required `risk: { level: low|medium|high, summary }` to `ReviewReportSchema` (mcp-foundry) and optional `risk` to `PrReviewRequestSchema` (shared, for API compatibility). Render `**Merge risk: …**` in `renderPrReviewBody`, include it in `formatReview`, runner fallback reports, submitPrReview event/log.\n3. Skill onboarding: add `apps/runner/src/skills.ts` (`installSkills` writing `.claude/skills/<name>/SKILL.md` and `.opencode/skills/<name>/SKILL.md`) plus `foundry skills list|install [names...] [--all]` CLI. Call it in `finishOnboarding()` before the onboarding commit so the recipe PR carries the skills.\n4. Skill loading: Claude adapter passes `skills: \"all\"`; OpenCode config passes `skills.paths: [\".claude/skills\", \".opencode/skills\"]`.\n5. Tests: skills install/list, playbook prompt includes merge-risk, adapter options include skills, PR review body shows risk, update all review-tool literals in runner/control/e2e/mcp tests. Docs: docs/api.md, docs/foundry-dot-dir.md, docs/onboarding.md.\n6. Verify with biome, the affected vitest projects, and repo checks.",
  "findings": [
    "triage: Mapped the review pipeline (assembleReviewPrompt, mcp-foundry review tool, PrReviewRequest/renderPrReviewBody, submitPrReview), the runner's onboarding/PR-review flow, and both harness adapters. Verified Claude Agent SDK supports `skills: 'all'` and OpenCode supports `skills.paths`; built-in playbooks live in packages/playbooks, and the runner already installs repo files during onboarding.",
    "investigating: Plan recorded: ship a merge-risk built-in skill, surface its level+summary in the review report and PR comment, install skills into both harness folders during onboarding and via a CLI, and load repo skills from those folders in both adapters.",
    "implementing: Implemented merge-risk end to end: a built-in merge-risk skill embedded in the reviewer prompt and installed into `.claude/skills`/`.opencode/skills`; `review` now takes a required `risk {level,summary}` that renders in the GitHub PR review body and job timeline; onboarding installs playbook skills in the recipe PR and `foundry skills install` updates them later; both harnesses load repo skills. Added/updated unit tests and docs; lint, typecheck and tests pass.",
    "review: The reviewer did not report a verdict.",
    "implementing: Addressed the prior review round: the recorded blocking finding was the reviewer session failing to call the MCP review tool (its transcript had a complete approve verdict but it repeatedly invoked the host's ReportFindings instead). Hardened the harness: Claude sessions now enable exactly the repo's `.claude/skills` names rather than `skills: \"all\"` (no user/plugin skill leakage), ReportFindings is disallowed for Foundry sessions, and the reviewer playbook now names `foundry.review`/`mcp__foundry__review` and forbids generic findings tools. Also updated the zh-CN docs to match. Lint, typecheck and tests pass.",
    "review: Reviewed the full diff against origin/main plus the surrounding code it touches.\n\nVerified locally in the matching sibling checkout (same HEAD, dependencies installed): `pnpm test:unit` (31 files / 237 tests), the affected runner job/daemon tests (26 tests), `tsc` typecheck for @foundry/{shared,playbooks,mcp-foundry,harness-claude-code,harness-opencode,runner}, and `biome check` over the touched packages — all pass. I also confirmed the pinned SDK 0.3.318 does support `options.skills?: string[] | \"all\"` (so the adapter's filter is real, not dead config), that OpenCode 1.19.5's config schema accepts `skills.paths`, and that Claude Code's SKILL.md frontmatter parser tolerates the leading blank line in the new skill file.\n\nAcceptance criteria:\n- Auto PR review risk: satisfied. `ReviewReportSchema` (mcp-foundry) now requires `risk: {level, summary}`; `renderPrReviewBody` renders `**Merge risk: …**` plus reasons; the control plane records it in the review comment body, the timeline message, evidence outputTail, and the log; the runner's `formatReview` and both fallback reports carry it.\n- Skill onboarding: satisfied. `installSkills` writes `.claude/skills/<name>/SKILL.md` and `.opencode/skills/<name>/SKILL.md`; onboarding calls it before the recipe commit (covered by a real-git assertion in job-runner.test.ts) and `foundry skills list|install [names] [--all]` covers post-onboarding install/update. Unknown names are validated before any write.\n- Skill loading: satisfied. The Claude adapter passes the repo's declared skill names (dismissing user/plugin skills), and OpenCode is pointed at both folders. This also addresses the prior round's blocker: `ReportFindings` is disallowed for Claude sessions and the reviewer playbook explicitly names `foundry.review`/`mcp__foundry__review` and forbids generic findings tools.\n\nOne environment note, not a code defect: the review harness that launched *this* session is running pre-branch runner code (the advertised `review` tool schema has no `risk`, and my prompt is the old reviewer text), so I could not exercise the new required field end-to-end here; the code paths and unit tests above do cover it.\n\nUI design: not applicable — no component, page, style or token files changed, and there is no user-facing panel change. Security: checked — no secrets/credentials introduced; skill content is built-in; `installSkills` validates names against the registry so no path traversal; newly native-loaded repo skills are repo-controlled content the agent already reads, and policy command/network restrictions still apply.\n\nNo blocking findings. Six non-blocking suggestions are below.",
    "reviewing: Reviewer approved. Running the recipe checks against the final tree before finishing."
  ],
  "checks": [
    {
      "name": "lint",
      "status": "passed"
    },
    {
      "name": "typecheck",
      "status": "passed"
    },
    {
      "name": "test",
      "status": "passed"
    }
  ],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-12T08:12:37.246Z"
}
```
