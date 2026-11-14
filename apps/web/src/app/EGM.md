# web/src/app

## Overview

The Next.js App Router root. It holds the root layout, the home redirect, all
server actions used by the panel, the `(panel)` route group, the auth/setup
pages, the `/install.sh` script endpoint, and the `api/` route handlers.

## Interface

- `layout.tsx` — `RootLayout` with metadata (`title: "Foundry"`, manifest, theme color) and the display/mono web fonts ([layout.tsx:RootLayout]).
- `page.tsx` — `Home` redirects to `/board` ([page.tsx:Home]).
- `actions.ts` — server actions (all exported async functions): `signInAction`, `signOutAction`, `createTeamAction`, `syncReposAction`, `switchTeamAction`, `answerAction`, `helpfulAction`, `messageAction`, `jobLimitsAction`, `retryAction`, `cancelAction`, `createJoinTokenAction`, `runnerStatusAction`, `onboardAction`, `repoSettingsAction`, `syncSkillsAction`, `inviteAction`, `teamSettingsAction`, `notifyPrefAction` ([actions.ts]).
- Subdirectories and pages:
  - (panel): [./\(panel\)/EGM.md](<./\(panel\)/EGM.md>) — authenticated panel shell and pages.
  - api: [./api/EGM.md](./api/EGM.md) — route handlers (auth, GitHub, runner API, webhooks, push, realtime).
  - install.sh: [./install.sh/EGM.md](./install.sh/EGM.md) — `GET /install.sh` runner installer script.
  - setup: [./setup/EGM.md](./setup/EGM.md) — first-run team creation page.
  - signin: [./signin/EGM.md](./signin/EGM.md) — GitHub sign-in page and error copy.

## Invariants

- Panel actions are `"use server"`; every state-changing action resolves the caller's team and, where required, admin role before touching control (`teamJob`, `teamRepo`, `requireAdmin`, `requireTeam`) ([actions.ts]).
- Message attachments are limited to 5 images of 5 MB each and PNG/JPEG/WebP; the type is inferred from extension when the browser omits it ([actions.ts:messageAction], [actions.ts:messageImageType]).
- Job-limit saves are all-or-nothing: an invalid field leaves both saved values untouched ([actions.ts:jobLimitsAction]).
- `retryAction` only accepts a known runner stage, defaulting to `triage` ([actions.ts:retryAction]).
- The root layout is the only place global metadata/fonts are declared.

## Side Effects

- Server actions write to the DB through `@foundry/control`, set cookies (`foundry_team`, `foundry_install`), revalidate paths, and redirect.
- `messageAction` stores uploaded images as artifacts, then records the message ([actions.ts:messageAction]).
- `syncSkillsAction` opens a PR that installs built-in skills and redirects with the PR URL or an error query ([actions.ts:syncSkillsAction]).

## Verification

- Run: `pnpm test`
