---

name: code-review
description: Review a branch or pull request against its ticket, covering code quality, UI design and security, and report findings by severity. Use during Foundry's independent review.
---

# Code review

Review the change against the ticket's goal and acceptance criteria, not the code in isolation. Work
from the full diff, read as much surrounding code as you need, and report only findings you can point
to in the change.

## Review areas

Cover all three areas on every review. If an area does not apply (for example, no UI files changed),
say so in the summary instead of inventing findings.

### 1. Code quality

- **Correctness:** does the change do what the ticket asks without breaking existing behavior?
- **Acceptance criteria:** check each item in the ticket explicitly.
- **Tests:** do they exercise the new behavior, including the failure paths? For a bug fix, a
  regression test must fail before the change and pass after it.
- **Scope:** unrelated edits, debug leftovers, dead code, commented-out code, noisy logging, TODOs.
- **Maintainability:** naming, duplication, error handling, resource cleanup, concurrency, and
  whether the change fits the architecture around it.
- **Conventions:** match the naming, layout and style of the code around the change.

### 2. UI design

Applies when the diff touches UI files (components, pages, styles, tokens) or the ticket changes
user-facing behavior.

- **Design system:** compare against the repo's design system and tokens (for example `DESIGN.md`,
  a theme file or `globals.css`). Flag invented colors, spacing, radii, type scales or components
  that diverge from the system.
- **Layout and states:** hierarchy, spacing, responsive behavior, light/dark themes, and the
  empty, loading, error and disabled states.
- **Accessibility:** labels, focus order, keyboard operation, contrast, semantic markup and ARIA.
- **Consistency:** the change should look and behave like the screens around it.
- **Evidence:** if the implementer attached a screenshot or UI files are in the worktree, inspect
  them. The verify stage captures the final screenshots later.
- Do not block on subjective taste. Block on broken layout, inaccessible controls, inconsistent
  tokens, or UI that contradicts the design system.

### 3. Security

- **Secrets:** credentials, tokens or `.env` values in code, logs, fixtures or error messages.
- **Injection:** SQL, command, template, path traversal and unsafe deserialization.
- **Authorization:** missing authentication or permission checks, privilege escalation, and missing
  tenant/team scoping.
- **Input and output:** validation at boundaries, output encoding, unsafe defaults and data exposure.
- **Supply chain:** new or changed dependencies, risky migrations, and CI or workflow changes.
- Block on any exploitable issue or missing authorization check.

## How to review

Start with `git diff --stat origin/<default-branch>...HEAD`, then read the full diff and as much
surrounding code as you need. You are inspecting a clean checkout of the job branch; do not edit it,
install dependencies, or run commands that change files.

Use `severity: "blocking"` only for defects that must be fixed before merge: wrong behavior, a broken
acceptance criterion, a missing regression test for a bug, an accessibility or design-system break, a
security or data-loss risk, or a test suite that does not actually prove the change. Use
`severity: "non_blocking"` for nits and suggestions. Be specific: name the file and line, describe
the failure, and say what good looks like.
