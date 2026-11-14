# web/src/app/(panel)

## Overview

The authenticated panel route group. `layout.tsx` enforces session/team
resolution and renders the persistent shell (nav, live connection pill, team
switcher, sign-out). Each child directory is one panel page.

## Interface

- `PanelLayout` — async layout calling `requireTeam()`, rendering `PanelShell` with the nav links `/board`, `/inbox`, `/runners`, `/repos`, `/metrics`, `/team`, `/settings`, a `LiveRefresh` pill, an optional team switcher, and sign-out ([layout.tsx:PanelLayout]).
- Subdirectories and pages:
  - board: [./board/EGM.md](./board/EGM.md) — kanban board of jobs by status lane.
  - inbox: [./inbox/EGM.md](./inbox/EGM.md) — questions, handovers, blocked, and in-flight tickets for the user.
  - jobs: [./jobs/EGM.md](./jobs/EGM.md) — job detail and configuration routes.
  - metrics: [./metrics/EGM.md](./metrics/EGM.md) — team metrics dashboard.
  - repos: [./repos/EGM.md](./repos/EGM.md) — repo onboarding, readiness, merge/harness settings, skills sync.
  - runners: [./runners/EGM.md](./runners/EGM.md) — runner fleet, capacity, drain/remove, join token.
  - settings: [./settings/EGM.md](./settings/EGM.md) — notification preferences, push toggle, team settings.
  - team: [./team/EGM.md](./team/EGM.md) — members, invites, and roles.

## Invariants

- Every panel page is behind `requireTeam()`; unauthenticated users are redirected to `/signin`, users without a team to `/setup` ([../server/session.ts:requireTeam]).
- The nav order and labels are fixed in the `LINKS` table ([layout.tsx:LINKS]).
- The team switcher renders only when the user belongs to more than one team ([layout.tsx:PanelLayout]).
- All panel pages live under this route group and therefore share the shell and the `LiveRefresh` connection.

## Side Effects

- Triggers the session/team DB lookups per navigation (deduped per request by React `cache`).
- The live pill opens a WebSocket and causes server re-renders (see components).

## Verification

- Run: `pnpm test`
