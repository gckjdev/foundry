# Handoff brief: Add code review step

Stage reached: **implementing** · harness: claude-code · updated 2026-11-10T14:08:09.777Z

## Plan

## Chosen design: independent reviewer stage (option 2)

Pipeline: `triage → investigating → implementing → reviewing → verifying → PR`. When a job enters
`reviewing`, the runner starts a **fresh, read-only harness session** in a throwaway detached
worktree of the job branch. The reviewer reports a verdict + findings through a new `review` MCP
tool. Blocking findings loop back to `implementing` up to `max_review_loops`; a clean review (or an
exhausted loop) lets the job continue to `verifying`. Every verdict is stored as evidence, and the
confidence gate holds a PR for a human if the latest review is blocking.

### Steps

1. **State machine + policy** (`packages/shared`): add `reviewing` to `JOB_STATUSES` and
   `RUNNER_STAGES`; allow implementing→reviewing, reviewing→implementing/verifying; add
   `STATUS_TITLES`. Add `max_review_loops` (default 2) to `PolicySchema`.
2. **Gate** (`packages/shared/src/gate.ts`, `packages/control/src/merge-gate.ts`): add a
   `code_review` rule fed by the latest `note: "code review"` evidence; a missing or failed review
   blocks auto-merge.
3. **MCP** (`packages/mcp-foundry`): add `review` to `FOUNDRY_TOOL_NAMES`; add the `review` tool
   (verdict, summary, findings) and add `reviewing` to the `stage` enum.
4. **Playbooks** (`packages/playbooks`): insert the Reviewing step into `default.md` and
   `onboarding.md`; add `reviewer.md` and `assembleReviewPrompt()`.
5. **Read-only sessions** (`packages/harness-core`, `harness-claude-code`, `harness-opencode`):
   add `allowEdits?: boolean` to `PermissionPolicy`; deny Edit/Write tools and OpenCode edits when
   false.
6. **Runner** (`apps/runner`): `createDetachedWorktree` gains a `commit` option. In `JobRunner`,
   enforce the stage order, run the reviewer between turns on a detached worktree with a separate
   MCP registration/token, account for its cost, record evidence, loop findings back to
   implementing, and cap loops with `max_review_loops`.
7. **Panel** (`apps/web`): add the `reviewing` board lane, status tone, and running-status query.
8. **Docs**: add `docs/adr/002-independent-code-review-stage.md` (the production design proposal)
   and update the AGENTS.md stage order.
9. **Tests**: update runner/playbook/control/e2e stage sequences to include the reviewer turn; add
   tests for approval, changes-requested looping, loop exhaustion, gate blocking, read-only
   permissions, and the MCP tool.

### Files expected to change

- `packages/shared/src/{states,policy,gate}.ts` and tests
- `packages/control/src/{merge-gate,queries,github-sync}.ts` and tests
- `packages/mcp-foundry/src/{server,index}.ts` and tests
- `packages/playbooks/src/{index.ts,playbooks/default.md,playbooks/onboarding.md,playbooks/reviewer.md}` and tests
- `packages/harness-core/src/types.ts`, `packages/harness-{claude-code,opencode}/src/*`
- `apps/runner/src/{workspace,job-runner}.ts` and tests; `apps/runner/src/daemon.test.ts`
- `apps/web/src/app/(panel)/board/page.tsx`, `apps/web/src/components/status.tsx`
- `tests/e2e/pipeline.test.ts`
- `docs/adr/002-independent-code-review-stage.md`, `AGENTS.md`

## Findings

- investigating: The design is settled: a distinct `reviewing` stage backed by a fresh, read-only reviewer session in a detached worktree, with findings looping back to implementing and a gate rule for unresolved blockers. I mapped every touch point from the state machine through the runner, MCP, playbooks, panel, and tests, and recorded the plan.
- implementing: Implemented the independent reviewing stage end to end: state machine and transitions, the `review` MCP tool, runner orchestration with a fresh read-only session in a detached worktree, review-loop policy, the confidence-gate rule, panel status/lane, product docs and an ADR. Added unit, control/API and e2e coverage for approval, blocking-findings loop-back, loop exhaustion, read-only enforcement and gate blocking.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

- Q: Which code-review design should I implement? I traced the pipeline (triage → investigating → implementing → verifying → PR) through packages/shared/src/states.ts, the runner's toolStage enforcement, the built-in playbooks, and the panel board. Three viable designs:

1. **Self-review stage (recommended).** Insert a `reviewing` stage between implementing and verifying. The same agent re-reads its full diff against the ticket's acceptance criteria, looks for bugs, debug leftovers and weak tests, fixes them, records what it checked, then verifies. Changes: state machine + MCP stage enum + playbook + board/timeline + tests. No extra session cost, portable across harnesses. Catches omissions, but it is not independent scrutiny.

2. **Independent reviewer stage.** Insert `reviewing`, but the runner starts a fresh, read-only reviewer session (same harness, empty context, same worktree) with the ticket and diff. It reports blocking/non-blocking findings; blockers loop back to implementing up to a configurable limit, a clean review moves to verifying, and findings are stored as evidence. Strongest quality, but much larger: a second harness session per job, extra cost, review-loop policy, prompt design, and substantially more runner/test work.

3. **Review step inside verifying (no new stage).** Keep the stage list unchanged; add a mandatory self-review checklist in the verifying playbook and record it as review evidence before confidence. Smallest surface, but no board lane and weakest product visibility.

I recommend option 1: it is a real, visible stage with the smallest reliable change. Option 2 can be layered on later. If you prefer a different order (review after verifying) or want onboarding jobs excluded, say so in your answer.
  A: Independent reviewer stage

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "498690a9-fd09-487c-8d39-3aa28294e4c2",
  "title": "Add code review step",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "cffc8a6c-73c7-4e6e-b973-01ad4abae311",
  "plan": "## Chosen design: independent reviewer stage (option 2)\n\nPipeline: `triage → investigating → implementing → reviewing → verifying → PR`. When a job enters\n`reviewing`, the runner starts a **fresh, read-only harness session** in a throwaway detached\nworktree of the job branch. The reviewer reports a verdict + findings through a new `review` MCP\ntool. Blocking findings loop back to `implementing` up to `max_review_loops`; a clean review (or an\nexhausted loop) lets the job continue to `verifying`. Every verdict is stored as evidence, and the\nconfidence gate holds a PR for a human if the latest review is blocking.\n\n### Steps\n\n1. **State machine + policy** (`packages/shared`): add `reviewing` to `JOB_STATUSES` and\n   `RUNNER_STAGES`; allow implementing→reviewing, reviewing→implementing/verifying; add\n   `STATUS_TITLES`. Add `max_review_loops` (default 2) to `PolicySchema`.\n2. **Gate** (`packages/shared/src/gate.ts`, `packages/control/src/merge-gate.ts`): add a\n   `code_review` rule fed by the latest `note: \"code review\"` evidence; a missing or failed review\n   blocks auto-merge.\n3. **MCP** (`packages/mcp-foundry`): add `review` to `FOUNDRY_TOOL_NAMES`; add the `review` tool\n   (verdict, summary, findings) and add `reviewing` to the `stage` enum.\n4. **Playbooks** (`packages/playbooks`): insert the Reviewing step into `default.md` and\n   `onboarding.md`; add `reviewer.md` and `assembleReviewPrompt()`.\n5. **Read-only sessions** (`packages/harness-core`, `harness-claude-code`, `harness-opencode`):\n   add `allowEdits?: boolean` to `PermissionPolicy`; deny Edit/Write tools and OpenCode edits when\n   false.\n6. **Runner** (`apps/runner`): `createDetachedWorktree` gains a `commit` option. In `JobRunner`,\n   enforce the stage order, run the reviewer between turns on a detached worktree with a separate\n   MCP registration/token, account for its cost, record evidence, loop findings back to\n   implementing, and cap loops with `max_review_loops`.\n7. **Panel** (`apps/web`): add the `reviewing` board lane, status tone, and running-status query.\n8. **Docs**: add `docs/adr/002-independent-code-review-stage.md` (the production design proposal)\n   and update the AGENTS.md stage order.\n9. **Tests**: update runner/playbook/control/e2e stage sequences to include the reviewer turn; add\n   tests for approval, changes-requested looping, loop exhaustion, gate blocking, read-only\n   permissions, and the MCP tool.\n\n### Files expected to change\n\n- `packages/shared/src/{states,policy,gate}.ts` and tests\n- `packages/control/src/{merge-gate,queries,github-sync}.ts` and tests\n- `packages/mcp-foundry/src/{server,index}.ts` and tests\n- `packages/playbooks/src/{index.ts,playbooks/default.md,playbooks/onboarding.md,playbooks/reviewer.md}` and tests\n- `packages/harness-core/src/types.ts`, `packages/harness-{claude-code,opencode}/src/*`\n- `apps/runner/src/{workspace,job-runner}.ts` and tests; `apps/runner/src/daemon.test.ts`\n- `apps/web/src/app/(panel)/board/page.tsx`, `apps/web/src/components/status.tsx`\n- `tests/e2e/pipeline.test.ts`\n- `docs/adr/002-independent-code-review-stage.md`, `AGENTS.md`",
  "findings": [
    "investigating: The design is settled: a distinct `reviewing` stage backed by a fresh, read-only reviewer session in a detached worktree, with findings looping back to implementing and a gate rule for unresolved blockers. I mapped every touch point from the state machine through the runner, MCP, playbooks, panel, and tests, and recorded the plan.",
    "implementing: Implemented the independent reviewing stage end to end: state machine and transitions, the `review` MCP tool, runner orchestration with a fresh read-only session in a detached worktree, review-loop policy, the confidence-gate rule, panel status/lane, product docs and an ADR. Added unit, control/API and e2e coverage for approval, blocking-findings loop-back, loop exhaustion, read-only enforcement and gate blocking."
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
  "qa": [
    {
      "question": "Which code-review design should I implement? I traced the pipeline (triage → investigating → implementing → verifying → PR) through packages/shared/src/states.ts, the runner's toolStage enforcement, the built-in playbooks, and the panel board. Three viable designs:\n\n1. **Self-review stage (recommended).** Insert a `reviewing` stage between implementing and verifying. The same agent re-reads its full diff against the ticket's acceptance criteria, looks for bugs, debug leftovers and weak tests, fixes them, records what it checked, then verifies. Changes: state machine + MCP stage enum + playbook + board/timeline + tests. No extra session cost, portable across harnesses. Catches omissions, but it is not independent scrutiny.\n\n2. **Independent reviewer stage.** Insert `reviewing`, but the runner starts a fresh, read-only reviewer session (same harness, empty context, same worktree) with the ticket and diff. It reports blocking/non-blocking findings; blockers loop back to implementing up to a configurable limit, a clean review moves to verifying, and findings are stored as evidence. Strongest quality, but much larger: a second harness session per job, extra cost, review-loop policy, prompt design, and substantially more runner/test work.\n\n3. **Review step inside verifying (no new stage).** Keep the stage list unchanged; add a mandatory self-review checklist in the verifying playbook and record it as review evidence before confidence. Smallest surface, but no board lane and weakest product visibility.\n\nI recommend option 1: it is a real, visible stage with the smallest reliable change. Option 2 can be layered on later. If you prefer a different order (review after verifying) or want onboarding jobs excluded, say so in your answer.",
      "answer": "Independent reviewer stage"
    }
  ],
  "uncertainties": [],
  "updatedAt": "2026-11-10T14:08:09.777Z"
}
```
