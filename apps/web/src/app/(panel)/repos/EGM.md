# web/src/app/(panel)/repos

## Overview

Repo management page: shows each repo's onboarding status, recipe PR, runner
readiness, and (for admins) merge mode, default harness/model, GitHub Project
id, and a skills-sync action.

## Interface

- Default export `Repos({ searchParams })` — calls `requireTeam()`, then `teamReposWithReadiness(ctx, team.id)`; for an empty list and an admin caller it first runs `syncUnlinkedInstallations` ([page.tsx:Repos]).
- `ONBOARDING` — status label/tone map for `not_started`, `running`, `pr_open`, `done`, `failed` ([page.tsx:ONBOARDING]).
- Forms submit to `onboardAction`, `repoSettingsAction`, `syncReposAction`, `syncSkillsAction` ([page.tsx:Repos], [actions.ts]).

## Invariants

- Onboarding button is hidden while a recipe PR is open; it is labeled Retry and sends `restart=1` when onboarding is running or failed ([page.tsx:Repos]).
- Settings forms are keyed by the saved `mergeMode|defaultHarness|defaultModel|ghProjectId` tuple so uncontrolled selects remount with persisted values ([page.tsx:Repos]).
- The skills PR link is rendered only when `sp.skills` is an absolute `http(s)` URL; user-editable query strings are not echoed as links otherwise ([page.tsx:Repos]).
- Only admins see Sync from GitHub, Install GitHub App, settings, and skills sync controls ([page.tsx:Repos]).
- `defaultHarness` options come from `HARNESS_IDS`; the empty option means team default ([page.tsx:Repos]).
- Readiness rows mark a repo ready per runner and flag a stale recipe when `recipeSha` differs from the repo's current sha ([page.tsx:Repos]).

## Side Effects

- Read-only repo/readiness queries; the admin-only auto-sync may call GitHub when the list is empty.
- Actions write repo settings, start onboarding, or open a skills PR ([actions.ts]).

## Verification

- Run: `pnpm test`
