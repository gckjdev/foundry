# web/src/app/(panel)/runners

## Overview

Runner fleet page: online/slot capacity, a laptops-only capacity card, a table
of runners with state, machine specs, harnesses, per-repo readiness, and running
jobs, plus admin drain/resume/remove controls and a join-token generator.

## Interface

- Default export `Runners()` — calls `requireTeam()`, `teamRunners`, `runningJobsByRunner`, a readiness join over `runnerRepoReadiness`/`repos`, and `capacityCard` ([page.tsx:Runners]).
- Client `JoinToken()` — calls `createJoinTokenAction` and displays the returned token ([join-token.tsx:JoinToken]).
- Admin form submits to `runnerStatusAction` with status `active`/`draining`/`removed` ([page.tsx:Runners], [actions.ts:runnerStatusAction]).

## Invariants

- A runner is "up" when `isOnline(r, now)`; offline runners show the last-seen age ([page.tsx:Runners], [../shared isOnline]).
- Free slots are `sum(maxConcurrency)` over online, accepting, active runners minus running jobs, floored at 0 ([page.tsx:Runners]).
- The capacity card renders only when there are runners and no shared runners ([page.tsx:Runners]).
- Harness rows are colored by installed/auth state; readiness rows are green only when ready and the recipe sha matches ([page.tsx:Runners]).
- The join token is shown as valid for 7 days; personal runners are owned by the requesting user ([join-token.tsx:JoinToken]).
- The install copy documents `curl … /install.sh`, Homebrew/apt/dnf, `foundry runner join`, and `install-service` with `--system` for boot-time daemon ([page.tsx:Runners]).

## Side Effects

- Read-only DB queries plus `capacityCard`.
- `createJoinTokenAction` writes a join token; `runnerStatusAction` sets runner status and revalidates `/runners` ([actions.ts]).
- Re-renders on realtime `runners` and `jobs` changes (`tablesForPage("/runners")`).

## Verification

- Run: `pnpm test`
