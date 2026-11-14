# @foundry/shared

## Overview

Foundation package: Zod schemas, the job state machine, merge gate, policy/recipe parsing, proxy resolution, structured logging and shared formatting. Every other workspace package depends on it; it depends on none.

Package boundary: name `@foundry/shared`, ESM, exports TypeScript source `[package.json:exports]`. Subpath exports `./proxy` and `./github-host` exist so the web app can import them without the rest of the barrel `[package.json:exports]`. Runtime dependencies are `zod`, `yaml` and `picomatch` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): all implementation and the barrel `index.ts` that re-exports every module.

## Interface

- `./src/index.ts` re-exports `api`, `brief`, `comments`, `diff`, `events`, `gate`, `install-script`, `log`, `notify`, `policy`, `pricing`, `recipe`, `risk`, `scheduler`, `states`, `ticket`, `tokens`, `version` `[src/index.ts]`.
- `@foundry/shared/proxy` resolves `./src/proxy.ts`; `@foundry/shared/github-host` resolves `./src/github-host.ts` `[package.json:exports]`.

## Invariants

- The package is a leaf: no `@foundry/*` imports appear in its source.
- Every module is side-effect-free at import time; process I/O happens only inside called functions.

## Side Effects

- None at import; see [src](./src/EGM.md) for the functions that log, spawn `scutil`, or mutate the environment.

## Verification

- Run: `pnpm test`
