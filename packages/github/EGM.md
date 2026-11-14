# @foundry/github

## Overview

GitHub integration behind one client interface: Octokit in production, an in-memory fake in tests, plus webhook signature helpers. Package boundary: name `@foundry/github`, ESM, exports TypeScript source `[package.json:exports]`. Single entry point `.` → `./src/index.ts` `[package.json:exports]`. Runtime dependencies are `@octokit/rest`, `@octokit/auth-app` and `@octokit/webhooks-methods` `[package.json:dependencies]`.

## Subdirectories & Boundaries

- [src](./src/EGM.md): the `GitHubClient` interface, Octokit and fake implementations, webhook verification.

## Interface

- `.` exports `GitHubClient`, `OctokitGitHubClient`, `FakeGitHub`, `combineCi`, `verifyWebhookSignature`, `signWebhookPayload`, `getGitHub`, `setGitHub` `[src/index.ts]`.

## Invariants

- All Foundry code calls GitHub through `GitHubClient`, so tests swap in `FakeGitHub`.
- Webhook signatures are verified against the raw body before parsing `[src/webhooks.ts:verifyWebhookSignature]`.

## Side Effects

- `OctokitGitHubClient` makes authenticated REST/GraphQL calls and mints installation tokens.
- `FakeGitHub` is pure memory.

## Verification

- Run: `pnpm test`
