# web/src

## Overview

Application source for the control plane: Auth.js configuration,
Next.js instrumentation hooks, the App Router tree, shared UI components, and
server-only helpers that construct the in-process control context.

## Interface

- `auth.ts` — NextAuth setup exporting `handlers`, `auth`, `signIn`, `signOut`; GitHub provider, JWT sessions, `/signin` pages, and a `jwt` callback that upserts the panel user and stamps `userId`/`login` on the token ([auth.ts]).
- `instrumentation.ts` — `register()` runs only on the Node.js runtime and delegates to `registerNode()` ([instrumentation.ts:register]).
- `instrumentation.node.ts` — `registerNode()` prefers IPv4 DNS order, installs the proxied `fetch`, and starts the control worker once when `DATABASE_URL` and `FOUNDRY_SECRET` are set (skipped during production build) ([instrumentation.node.ts:registerNode]).
- Subdirectories:
  - app: [./app/EGM.md](./app/EGM.md) — App Router pages, server actions, and route handlers.
  - components: [./components/EGM.md](./components/EGM.md) — shared client/server UI helpers.
  - server: [./server/EGM.md](./server/EGM.md) — control context, session guards, HTTP helpers, proxied fetch.

## Invariants

- The control plane is a process-wide singleton guarded on `globalThis`; tests can inject an alternative via `setContextForTests` ([server/context.ts:getContext]).
- Every panel request resolves the signed-in user and current team exactly once per request via React `cache` ([server/session.ts:requireTeam]).
- GitHub OAuth requests go through the retrying proxy-aware fetch ([auth.ts:customFetch]).
- Instrumentation must not start the worker during `next build` ([instrumentation.node.ts:registerNode]).

## Side Effects

- Registers global DNS ordering and wraps `globalThis.fetch` with a proxy-aware, retrying implementation ([server/retry-fetch.ts:installProxiedFetch]).
- Opens the DB/GitHub/notifier control context and starts the background worker ([server/context.ts:ensureWorker]).
- Upserts the user row on first sign-in ([auth.ts:jwt]).

## Verification

- Run: `pnpm test`
