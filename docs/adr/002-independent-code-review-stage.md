# ADR 002: An independent code-review stage

Status: accepted · Date: 2026-11-10

## Context

Foundry's pipeline was `triage → investigating → implementing → verifying → PR`. The implementer
checks its own work with `run_checks`, but nothing inspects the diff with fresh eyes before
verification and the pull request. The product spec already lists adversarial reviewers as a 1.0
capability (`software-factory-product-spec.md` §6.3), and ticket #78 asked for a code-review step
that improves implementation quality.

Three designs were considered:

1. **Self-review stage.** Insert `reviewing` and have the same agent re-read its diff. Smallest
   change, no extra session cost, but the implementer tends to rationalise its own choices.
2. **Independent reviewer stage.** Insert `reviewing` and have the runner start a fresh, read-only
   reviewer session with the ticket and the diff. Blocking findings loop back to `implementing`.
   Stronger quality, larger change.
3. **Review step inside `verifying`.** No new state; a checklist recorded as evidence. Smallest
   product surface, weakest visibility and no independent context.

**Decision: option 2.** The point of the stage is independent scrutiny; a self-review inside the same
context adds process without adding much trust. The extra session is bounded by the existing job
cost and time caps, and the stage is visible in the panel and on GitHub.

## Design

### Pipeline

`queued → triage → investigating → implementing → reviewing → verifying → pr_ci`

`reviewing` is a first-class job status and runner stage. It appears in `JOB_STATUSES`,
`RUNNER_STAGES`, the state machine, `STATUS_TITLES`, the board's Working lane and GitHub's project
status. The legal edges are:

- `implementing → reviewing` (the implementer declares the change ready);
- `reviewing → implementing` (the reviewer requested changes);
- `reviewing → verifying` (the review approved, or its loop budget is spent);
- `reviewing → needs_input | failed | queued | cancelled`, like any running stage.

### Orchestration

The implementer calls `stage(reviewing)` and ends its turn. The runner then:

1. Commits the worktree and takes its HEAD.
2. Creates a **throwaway detached worktree** at that commit. The reviewer never touches the job's
   worktree, so a bug in the reviewer cannot corrupt the change.
3. Starts a **fresh harness session** in that worktree with no conversation history, using the same
   harness and model as the job. It gets the ticket body, the implementer's plan and summary, and
   instructions to review the diff against `origin/<default-branch>`.
4. Gives the reviewer a **separate MCP registration** and a **read-only permission policy**: Edit,
   Write, NotebookEdit and MultiEdit are removed; the repo's denied commands are extended with
   mutating git/shell/package-manager commands; web access is off.
5. Reads the verdict from the reviewer's `review` tool call, records it as `kind: "review"` evidence
   named `code review`, and removes the detached worktree.

The implementer is resumed only after the reviewer finishes. If it calls `stage(verifying)` before a
review has cleared the stage, the runner rejects the call and tells it to end its turn.

### Reporting contract

The reviewer reports exactly once through a dedicated MCP tool:

```jsonc
{
  "verdict": "approve" | "request_changes",
  "summary": "one or two sentences",
  "findings": [
    { "severity": "blocking" | "non_blocking", "file": "src/a.ts", "line": 12, "message": "..." }
  ]
}
```

Only the reviewer's MCP registration can report a review. The normal job agent calling `review`
gets an error, and the agent-facing `evidence` tool cannot create `review` evidence, so the gate
cannot be spoofed by a note.

### Loop policy and the gate

`policy.yaml` gains `max_review_loops` (default `2`). When the reviewer requests changes:

- While the budget remains, the runner moves the job back to `implementing`, commits a handoff
  checkpoint, and resumes the implementer with the blocking findings. Fixing the code and calling
  `stage(reviewing)` triggers another review.
- When the budget is spent, the job continues to `verifying` but the review evidence stays `failed`.
  The confidence gate has a new `code_review` rule: a missing or failed review evidence row blocks
  auto-merge and hands the pull request to a human. This mirrors the product's "risky changes go to
  a human" principle and avoids discarding useful work when a reviewer is stricter than the agent
  can satisfy.

A verify loop (`verifying → implementing`) clears the review clearance, so the fix is reviewed again
before the next verification. The review's cost and tokens flow through the normal usage events and
count against the job budget.

### Failure modes

- Reviewer harness error → the job fails with the reviewer's error; the worktree is removed.
- Reviewer ends without calling `review` → treated as a blocking finding and counted as a changes
  request, so it cannot silently approve by omission.
- Reviewer modifies its checkout → it is throwaway, so the job worktree is unaffected.
- Job paused during `reviewing` → `resumeStage` stays `reviewing`; the next runner runs a fresh
  review before continuing.
- Onboarding jobs follow the same stage order; the reviewer checks the generated `.foundry` files.

## Consequences

- Every ticket job pays for one extra harness session per review round. The existing
  `max_cost_per_job_usd`, `max_job_minutes` and `max_review_loops` caps bound it.
- The reviewer uses the same harness and model as the job. A future change can add a reviewer model
  or a reviewer router (spec §6.3) without changing the state machine.
- The gate is stricter: old or hand-built jobs without review evidence are held for a human rather
  than auto-merged.
- Tests cover approval, changes-requested looping, loop exhaustion, read-only permissions, the
  dedicated MCP registration, the gate rule and the e2e pipeline.
