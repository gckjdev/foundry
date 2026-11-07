# Handoff brief: Support GitHub Enterprise Server as the repo host

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T15:52:01.584Z

## Plan

1. Add `packages/shared/src/github-host.ts`: pure URL-derivation helpers (`normalizeGitHubHost`, `githubApiUrl`, `githubGraphqlUrl`, `githubOAuthAuthorizeUrl`, `githubOAuthTokenUrl`, `githubUserInfoUrl`, `githubGitBase`, `githubIssueUrl`, `githubInstallUrl`), an env resolver `resolveGitHubHostConfig` (applies `GITHUB_API_URL` / `FOUNDRY_GIT_BASE` overrides), and `loadGitHubEnvFromFile` for the runner's `.env` loading. Special-case github.com → `https://api.github.com`.
2. Export `./github-host` from `packages/shared/package.json`.
3. Add `packages/shared/src/github-host.test.ts` covering github.com vs GHES derivation, overrides, and `.env` loading.
4. `packages/github/src/octokit.ts`: accept optional `baseUrl` on `GitHubAppConfig` and pass it to both `new Octokit(...)` calls (REST + app auth + graphql all derive from it; Octokit's graphql rewrites `/api/v3` → `/api/graphql`). Default to `githubApiUrl(undefined)`.
5. `packages/github/src/index.ts`: pass `resolveGitHubHostConfig().apiUrl` as `baseUrl` to `OctokitGitHubClient`.
6. Extend `packages/github/src/octokit.mock.test.ts` with a GHES-origin MockAgent assertion that the client hits `https://github.example.com/api/v3/...` (no real GHES).
7. `apps/web/src/auth.ts`: set Auth.js GitHub `enterprise.baseUrl` from a non-github.com `GITHUB_HOST`; keep `customFetch`/`githubFetch`.
8. `apps/runner/src/workspace.ts`: use `resolveGitHubHostConfig().gitBase` for `remoteUrl`.
9. `apps/runner/src/cli.ts`: load `GITHUB_HOST`/`GITHUB_API_URL`/`FOUNDRY_GIT_BASE` from the nearby `.env` alongside proxy keys.
10. Panel pages: `apps/web/src/app/(panel)/jobs/[id]/page.tsx` and `repos/page.tsx` use `githubIssueUrl` / `githubInstallUrl`.
11. Document in `.env.example` and `docs/local-setup.md`.
12. Add `apps/runner/src/workspace.test.ts` for `remoteUrl` GITHUB_HOST behaviour.

## Findings

- triage: The ticket is clear and detailed with explicit acceptance criteria, config derivation table, and files to change. No ambiguity requiring a question.
- investigating: Mapped all five integration points (Octokit, Auth.js, runner git, panel links, docs) and confirmed Octokit's graphql already rewrites /api/v3 → /api/graphql, so a single derived REST baseUrl covers REST + app-auth + GraphQL.
- implementing: Ran targeted unit tests (19 pass), package typechecks for shared/github/runner/web, and the full recipe gate (lint + typecheck + test all pass). Confirmed GraphQL 404s on old GHES are already swallowed by the existing bestEffort wrapper around project sync.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

_none_

## Open uncertainties

- Auth.js enterprise path is not exercised against a live GHES (only typechecked); the derivation was verified by reading @auth/core's provider source.

```json
{
  "version": 1,
  "jobId": "cde3eeb9-390e-4e2c-b517-50da0dd41557",
  "title": "Support GitHub Enterprise Server as the repo host",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "56cf560e-a214-4a99-9700-31e21aa0db07",
  "plan": "1. Add `packages/shared/src/github-host.ts`: pure URL-derivation helpers (`normalizeGitHubHost`, `githubApiUrl`, `githubGraphqlUrl`, `githubOAuthAuthorizeUrl`, `githubOAuthTokenUrl`, `githubUserInfoUrl`, `githubGitBase`, `githubIssueUrl`, `githubInstallUrl`), an env resolver `resolveGitHubHostConfig` (applies `GITHUB_API_URL` / `FOUNDRY_GIT_BASE` overrides), and `loadGitHubEnvFromFile` for the runner's `.env` loading. Special-case github.com → `https://api.github.com`.\n2. Export `./github-host` from `packages/shared/package.json`.\n3. Add `packages/shared/src/github-host.test.ts` covering github.com vs GHES derivation, overrides, and `.env` loading.\n4. `packages/github/src/octokit.ts`: accept optional `baseUrl` on `GitHubAppConfig` and pass it to both `new Octokit(...)` calls (REST + app auth + graphql all derive from it; Octokit's graphql rewrites `/api/v3` → `/api/graphql`). Default to `githubApiUrl(undefined)`.\n5. `packages/github/src/index.ts`: pass `resolveGitHubHostConfig().apiUrl` as `baseUrl` to `OctokitGitHubClient`.\n6. Extend `packages/github/src/octokit.mock.test.ts` with a GHES-origin MockAgent assertion that the client hits `https://github.example.com/api/v3/...` (no real GHES).\n7. `apps/web/src/auth.ts`: set Auth.js GitHub `enterprise.baseUrl` from a non-github.com `GITHUB_HOST`; keep `customFetch`/`githubFetch`.\n8. `apps/runner/src/workspace.ts`: use `resolveGitHubHostConfig().gitBase` for `remoteUrl`.\n9. `apps/runner/src/cli.ts`: load `GITHUB_HOST`/`GITHUB_API_URL`/`FOUNDRY_GIT_BASE` from the nearby `.env` alongside proxy keys.\n10. Panel pages: `apps/web/src/app/(panel)/jobs/[id]/page.tsx` and `repos/page.tsx` use `githubIssueUrl` / `githubInstallUrl`.\n11. Document in `.env.example` and `docs/local-setup.md`.\n12. Add `apps/runner/src/workspace.test.ts` for `remoteUrl` GITHUB_HOST behaviour.",
  "findings": [
    "triage: The ticket is clear and detailed with explicit acceptance criteria, config derivation table, and files to change. No ambiguity requiring a question.",
    "investigating: Mapped all five integration points (Octokit, Auth.js, runner git, panel links, docs) and confirmed Octokit's graphql already rewrites /api/v3 → /api/graphql, so a single derived REST baseUrl covers REST + app-auth + GraphQL.",
    "implementing: Ran targeted unit tests (19 pass), package typechecks for shared/github/runner/web, and the full recipe gate (lint + typecheck + test all pass). Confirmed GraphQL 404s on old GHES are already swallowed by the existing bestEffort wrapper around project sync."
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
  "qa": [],
  "uncertainties": [
    "Auth.js enterprise path is not exercised against a live GHES (only typechecked); the derivation was verified by reading @auth/core's provider source."
  ],
  "updatedAt": "2026-11-07T15:52:01.584Z"
}
```
