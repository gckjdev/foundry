# @foundry/github — Source

## Overview

GitHub access behind a single `GitHubClient` interface: an Octokit implementation for production and an in-memory `FakeGitHub` for tests. Webhook helpers verify signatures. Every consumer goes through the interface so tests can swap implementations.

## Interface

- `[index.ts]` — `GitHubClient` interface and re-exports: `FakeGitHub`, `OctokitGitHubClient`, `combineCi`, `verifyWebhookSignature`, `signWebhookPayload`, `getGitHub`, `setGitHub`.
- `[types.ts]` — request/response types: issue, PR, CI, review, comment, checkout inputs and `CiStatus`.
- `[octokit.ts]` — `OctokitGitHubClient`: installation-auth Octokit client, `createInstallationClient` cached ~30 minutes, `latestById`, `findPullRequest`, `findPullRequestByBranch`, `createPullRequest`, `mergePullRequest`, issue label/comment methods, `createReview`, `listCi`, `openCheckRun`, `graphql` (Projects v2), `addAssignee`, `checkoutInfo`.
- `[webhooks.ts]` — `verifyWebhookSignature` (HMAC-SHA256 over the raw body), `signWebhookPayload`, and the webhook event type guards.
- `[fake.ts]` — `FakeGitHub`: in-memory implementation with seeding and inspection helpers used by tests.

## Invariants

- `OctokitGitHubClient` caches installation clients for ~30 minutes; the token is refreshed by eviction `[octokit.ts:createInstallationClient]`.
- `liveFetch` resolves at call time so a test that replaces `globalThis.fetch` after construction still wins `[octokit.ts]`.
- A 404 on an optional read is swallowed and mapped to `null`/empty rather than thrown `[octokit.ts]`.
- Posting an inline review comment that returns 422 retries as a plain comment `[octokit.ts:createReview]`.
- `latestById` returns the highest id; `findPullRequest` scans newest-first `[octokit.ts:latestById][octokit.ts:findPullRequest]`.
- `combineCi` severity is failure > pending > success > none `[index.ts:combineCi]`.
- `verifyWebhookSignature` uses a timing-safe comparison and returns false on any malformed header `[webhooks.ts:verifyWebhookSignature]`.

## Side Effects

- `OctokitGitHubClient` performs GitHub REST/GraphQL calls over the shared `retry-fetch` dispatcher (proxy-aware).
- It mints installation tokens via the configured GitHub App.
- `FakeGitHub` is pure memory; no network.
- `getGitHub`/`setGitHub` mutate a module-level singleton used by handlers.

## Verification

- Run: `pnpm test`
