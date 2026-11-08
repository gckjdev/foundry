# Handoff brief: Write a document to introduce the software factory concept and introduce the Foundry system

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T13:13:33.340Z

## Plan

## Plan: beginner introduction to software factories and Foundry

1. **Add `docs/introduction.md`** — beginner-friendly article explaining the software factory concept and Foundry, with:
   - The problem (tickets are still hand-crafted)
   - Definition of a software factory + what it is not
   - Why the concept works now (deterministic outer loop, model for judgment)
   - Foundry's issue-to-PR flow, the five stations, human vs machine roles
   - Architecture at a glance, the confidence gate
   - Safety/privacy, where it fits, and the road ahead (future maturity diagram)
   - Mermaid diagrams (repo convention) for: the factory line, the five stations, human/machine split, architecture, the confidence gate, and the maturity roadmap.
2. **Add `docs/introduction.zh-CN.md`** — Chinese mirror (repo convention that every human-facing doc has one).
3. **Add `docs/images/foundry-board.png`** — product screenshot of the panel Board with a demo team (all pipeline lanes populated; seeded in a throwaway database, no real user data).
4. **Link the new document** from `README.md` (and the zh README) in the Documentation table, plus a "new here" pointer near the top.
5. **Verify** with `run_checks` (lint, typecheck, tests). Docs only, so no app code changes.

Out of scope: changing the product, UI, or existing design docs.

## Findings

- triage: Ticket is clear enough to build: write a beginner-friendly introduction to the software factory concept and the Foundry system, with diagrams and a product screenshot. Starting investigation of existing docs, diagram conventions, and UI.
- triage: Ticket is clear: write a beginner-friendly introduction to the software factory concept and Foundry, with diagrams and a product screenshot. Moving on to study existing docs, diagram conventions, and UI.
- investigating: Investigated the existing bilingual docs, Mermaid conventions, panel UI and gate/playbook implementation. Captured a demo product screenshot on a throwaway database. Plan: add docs/introduction.md and its zh-CN mirror, the screenshot, and README links.
- implementing: Added the English and Chinese introduction documents with six Mermaid diagrams and a demo product screenshot, and linked them from both READMEs. Docs-only change; moving on to run the recipe checks.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "9773d993-b7d5-4f7f-b1ea-44e5e32cdad2",
  "title": "Write a document to introduce the software factory concept and introduce the Foundry system",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "640213bf-f88e-4543-b037-b3838f2d2efa",
  "plan": "## Plan: beginner introduction to software factories and Foundry\n\n1. **Add `docs/introduction.md`** — beginner-friendly article explaining the software factory concept and Foundry, with:\n   - The problem (tickets are still hand-crafted)\n   - Definition of a software factory + what it is not\n   - Why the concept works now (deterministic outer loop, model for judgment)\n   - Foundry's issue-to-PR flow, the five stations, human vs machine roles\n   - Architecture at a glance, the confidence gate\n   - Safety/privacy, where it fits, and the road ahead (future maturity diagram)\n   - Mermaid diagrams (repo convention) for: the factory line, the five stations, human/machine split, architecture, the confidence gate, and the maturity roadmap.\n2. **Add `docs/introduction.zh-CN.md`** — Chinese mirror (repo convention that every human-facing doc has one).\n3. **Add `docs/images/foundry-board.png`** — product screenshot of the panel Board with a demo team (all pipeline lanes populated; seeded in a throwaway database, no real user data).\n4. **Link the new document** from `README.md` (and the zh README) in the Documentation table, plus a \"new here\" pointer near the top.\n5. **Verify** with `run_checks` (lint, typecheck, tests). Docs only, so no app code changes.\n\nOut of scope: changing the product, UI, or existing design docs.",
  "findings": [
    "triage: Ticket is clear enough to build: write a beginner-friendly introduction to the software factory concept and the Foundry system, with diagrams and a product screenshot. Starting investigation of existing docs, diagram conventions, and UI.",
    "triage: Ticket is clear: write a beginner-friendly introduction to the software factory concept and Foundry, with diagrams and a product screenshot. Moving on to study existing docs, diagram conventions, and UI.",
    "investigating: Investigated the existing bilingual docs, Mermaid conventions, panel UI and gate/playbook implementation. Captured a demo product screenshot on a throwaway database. Plan: add docs/introduction.md and its zh-CN mirror, the screenshot, and README links.",
    "implementing: Added the English and Chinese introduction documents with six Mermaid diagrams and a demo product screenshot, and linked them from both READMEs. Docs-only change; moving on to run the recipe checks."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T13:13:33.340Z"
}
```
