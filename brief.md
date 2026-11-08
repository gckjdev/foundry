# Handoff brief: improve documentation

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T06:06:11.996Z

## Plan

## Scope
Documentation-only change. No source code touched. Exclude AGENTS.md and CLAUDE.md from translation per the ticket constraints.

## 1. Chinese versions of existing documents
- `README.zh-CN.md` — full translation of README.
- `software-factory-product-spec.zh-CN.md` — full translation of the 776-line product spec (all 10 sections, tables and mermaid kept valid).
- `docs/local-setup.zh-CN.md`
- `docs/onboarding.zh-CN.md`
- `docs/testing.zh-CN.md`
- `docs/testing-report.zh-CN.md` (translated snapshot; note that it is regenerated from the English report).
- `docs/adr/001-runner-runtime.zh-CN.md`
- Add a language-switch line at the top of each English/Chinese pair, and a short bilingual note in the English originals so readers can find the translation.

## 2. New solution-design documents (English + Chinese)
- `docs/design/overall-design.md` + `.zh-CN.md` — overall solution design: system context, software architecture (processes, packages, dependency graph, data flow, state machine, trust boundaries), deployment architecture (local dev, Docker Compose production, runner install/service, ports/proxy), non-functional concerns and trade-offs.
- `docs/design/components.md` + `.zh-CN.md` — component design for every component: apps/web, apps/realtime, apps/runner, packages/{shared,db,control,github,harness-core,harness-claude-code,harness-opencode,mcp-foundry,os-adapters,playbooks}, deploy/ and packaging. Each section: role, key modules, interfaces, data, failure modes, tests.
- `docs/design/use-cases.md` + `.zh-CN.md` — detailed design of core use cases with Mermaid sequence diagrams: sign-in/team/App setup, repo onboarding, issue→job ingest, claim/scheduling, playbook execution + MCP tools, verify loop + PR, confidence gate/auto-merge/handover, ask-and-answer, runner-loss resume, changes-requested/commands, readiness, realtime panel updates. Each includes preconditions, main flow, alternatives/failures, and implementation file references.

## 3. Navigation
- Add a "Documentation / 文档" section to `README.md` and `README.zh-CN.md` linking the new design docs and Chinese versions.

## 4. Verification
- `git status` / `git diff --stat` confirms only Markdown files changed.
- Check relative links resolve and Mermaid blocks are balanced.
- Run `mcp__foundry__run_checks` (recipe: lint, typecheck, test) even though no code changed.

## Expected files
~17 Markdown files added, 2 READMEs updated with links; zero code changes.

## Findings

- triage: Ticket is clear: documentation-only work. Surveyed all existing docs (README, product spec, local-setup, onboarding, testing, testing-report, ADR 001) and traced the code across apps/web, apps/realtime, apps/runner, packages/* and deploy/ so the new design documents describe the real implementation rather than the spec's intentions.
- investigating: Plan recorded: translate the seven existing human documents, add three bilingual design documents (overall architecture/deployment, per-component, core use cases with sequence diagrams), link them from the READMEs, and verify with diff/links/run_checks. Starting with the new design docs, then translations.
- implementing: Implementation is complete: all existing human docs now have zh-CN translations, and three new bilingual design documents cover overall architecture/deployment, every component, and core use cases with Mermaid sequence diagrams. Biome Markdown formatting was applied and the full recipe (lint, typecheck, test) passes.
- implementing: Merged origin/main into the branch and resolved the README conflict (kept the Documentation table and added main's `.foundry/` reference). Created a Chinese translation of the new `docs/foundry-dot-dir.md`, linked it from both READMEs and the Chinese onboarding page, and noted the new job-configuration panel page in the component docs. Only Markdown changed; running the full recipe now.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "18fbf456-c2d7-4670-8b8c-8ab25332d2b0",
  "title": "improve documentation",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "dc191dc4-e28f-4bab-84db-0fd2a98070b4",
  "plan": "## Scope\nDocumentation-only change. No source code touched. Exclude AGENTS.md and CLAUDE.md from translation per the ticket constraints.\n\n## 1. Chinese versions of existing documents\n- `README.zh-CN.md` — full translation of README.\n- `software-factory-product-spec.zh-CN.md` — full translation of the 776-line product spec (all 10 sections, tables and mermaid kept valid).\n- `docs/local-setup.zh-CN.md`\n- `docs/onboarding.zh-CN.md`\n- `docs/testing.zh-CN.md`\n- `docs/testing-report.zh-CN.md` (translated snapshot; note that it is regenerated from the English report).\n- `docs/adr/001-runner-runtime.zh-CN.md`\n- Add a language-switch line at the top of each English/Chinese pair, and a short bilingual note in the English originals so readers can find the translation.\n\n## 2. New solution-design documents (English + Chinese)\n- `docs/design/overall-design.md` + `.zh-CN.md` — overall solution design: system context, software architecture (processes, packages, dependency graph, data flow, state machine, trust boundaries), deployment architecture (local dev, Docker Compose production, runner install/service, ports/proxy), non-functional concerns and trade-offs.\n- `docs/design/components.md` + `.zh-CN.md` — component design for every component: apps/web, apps/realtime, apps/runner, packages/{shared,db,control,github,harness-core,harness-claude-code,harness-opencode,mcp-foundry,os-adapters,playbooks}, deploy/ and packaging. Each section: role, key modules, interfaces, data, failure modes, tests.\n- `docs/design/use-cases.md` + `.zh-CN.md` — detailed design of core use cases with Mermaid sequence diagrams: sign-in/team/App setup, repo onboarding, issue→job ingest, claim/scheduling, playbook execution + MCP tools, verify loop + PR, confidence gate/auto-merge/handover, ask-and-answer, runner-loss resume, changes-requested/commands, readiness, realtime panel updates. Each includes preconditions, main flow, alternatives/failures, and implementation file references.\n\n## 3. Navigation\n- Add a \"Documentation / 文档\" section to `README.md` and `README.zh-CN.md` linking the new design docs and Chinese versions.\n\n## 4. Verification\n- `git status` / `git diff --stat` confirms only Markdown files changed.\n- Check relative links resolve and Mermaid blocks are balanced.\n- Run `mcp__foundry__run_checks` (recipe: lint, typecheck, test) even though no code changed.\n\n## Expected files\n~17 Markdown files added, 2 READMEs updated with links; zero code changes.",
  "findings": [
    "triage: Ticket is clear: documentation-only work. Surveyed all existing docs (README, product spec, local-setup, onboarding, testing, testing-report, ADR 001) and traced the code across apps/web, apps/realtime, apps/runner, packages/* and deploy/ so the new design documents describe the real implementation rather than the spec's intentions.",
    "investigating: Plan recorded: translate the seven existing human documents, add three bilingual design documents (overall architecture/deployment, per-component, core use cases with sequence diagrams), link them from the READMEs, and verify with diff/links/run_checks. Starting with the new design docs, then translations.",
    "implementing: Implementation is complete: all existing human docs now have zh-CN translations, and three new bilingual design documents cover overall architecture/deployment, every component, and core use cases with Mermaid sequence diagrams. Biome Markdown formatting was applied and the full recipe (lint, typecheck, test) passes.",
    "implementing: Merged origin/main into the branch and resolved the README conflict (kept the Documentation table and added main's `.foundry/` reference). Created a Chinese translation of the new `docs/foundry-dot-dir.md`, linked it from both READMEs and the Chinese onboarding page, and noted the new job-configuration panel page in the component docs. Only Markdown changed; running the full recipe now."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T06:06:11.996Z"
}
```
