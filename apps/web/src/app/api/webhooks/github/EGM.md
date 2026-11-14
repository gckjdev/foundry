# web/src/app/api/webhooks/github

## Overview

GitHub webhook ingest. It verifies the HMAC signature, stores the delivery for
idempotency, acknowledges fast, and processes the payload after the response
via `after()`.

## Interface

- `POST(req)` — verifies `x-hub-signature-256` against `GITHUB_WEBHOOK_SECRET`, requires `x-github-delivery` and `x-github-event`, parses JSON, calls `storeWebhook`, schedules `processWebhook(ctx, id)`, and returns `{ ok: true, duplicate }` with 202 ([route.ts:POST]).

## Invariants

- A missing `GITHUB_WEBHOOK_SECRET` returns 500; a bad signature returns 401; missing headers or invalid JSON return 400 ([route.ts:handle]).
- `storeWebhook` returns a null id for a duplicate delivery, which is acknowledged with `duplicate: true` and not reprocessed ([route.ts:handle]).
- Every log line carries a correlation id, delivery id, and event name; the same scoped context is passed to `processWebhook` ([route.ts:POST], [route.ts:handle]).
- Processing runs in `after()` so GitHub's 10 s timeout is not exceeded; the worker retries anything still unprocessed ([route.ts:handle]).
- The raw body is used for signature verification before JSON parsing ([route.ts:handle]).

## Side Effects

- Writes a webhook row, schedules asynchronous processing that creates/updates jobs, and emits structured logs ([route.ts]).

## Verification

- Run: `pnpm test`
