# web

## Overview

`@foundry/web` is the Next.js 16 App Router control plane. It serves the
operator panel, Auth.js GitHub sign-in, GitHub webhook ingestion, signed artifact
downloads, and the bearer-token HTTP API the runner calls. It runs the control
plane in-process from `src/server/context.ts`.

## Interface

- Next.js configuration: `next.config.ts` default export `NextConfig` — standalone output, workspace TypeScript transpilation, externalized native packages, and a 32 MB server-action body limit ([next.config.ts:config]).
- Subdirectories:
  - src: [./src/EGM.md](./src/EGM.md) — application code (auth, instrumentation, App Router routes, components, server helpers).
  - public: [./public/EGM.md](./public/EGM.md) — static assets, including the push service worker.

## Invariants

- The app is `output: "standalone"` and traces from the monorepo root (`outputFileTracingRoot`) so workspace packages and DB migrations are included ([next.config.ts:config]).
- Workspace packages ship TypeScript source; they are listed in `transpilePackages` ([next.config.ts:config]).
- `postgres`, `web-push`, `nodemailer`, and `undici` are server-external (not bundled) ([next.config.ts:config]).
- The DB migrations directory is force-included in the output trace ([next.config.ts:outputFileTracingIncludes]).
- Dev origin `127.0.0.1` is allowed so Playwright can load `/_next/*` ([next.config.ts:config]).
- Turbopack's dev filesystem cache is disabled to avoid the Next 16.4 restart loop ([next.config.ts:config]).

## Side Effects

- Build/runtime only; the config itself performs no I/O. Runtime side effects (DB, GitHub, webhooks) belong to the `src` tree.

## Verification

- Run: `pnpm test`
