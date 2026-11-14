# web/src/app/api/runner/jobs/[id]/[action]

## Overview

One dynamic route dispatches every report a runner makes about a job it holds.
The action name selects a Zod-validated control call.

## Interface

- Supported actions: `events`, `stage`, `ask`, `evidence`, `pr-review`, `confidence`, `plan`, `checkpoint`, `pr`, `onboarding`, `inputs` ([route.ts:actions]).
- `POST(req, route)` — looks up the action, returns 404 for unknown actions, otherwise delegates ([route.ts:POST]).

## Invariants

- Every action is wrapped in `runnerRoute`, so the runner is authenticated and the body is validated against its shared schema (`EventsRequestSchema`, `StageRequestSchema`, `AskRequestSchema`, `EvidenceRequestSchema`, `PrReviewRequestSchema`, `ConfidenceRequestSchema`, `PlanRequestSchema`, `CheckpointRequestSchema`, `OpenPrRequestSchema`, `OnboardingResultSchema`, and `{take:boolean}`) ([route.ts:actions]).
- `stage` throws `ConflictError` when `runnerStage` returns null ("job moved by someone else") ([route.ts:actions]).
- `pr` and `onboarding` first resolve `ownedJob`, enforcing that the caller holds the job ([route.ts:actions]).
- `inputs` defaults `take` to true ([route.ts:actions]).
- Unknown action names never reach control and return 404 ([route.ts:POST]).

## Side Effects

- Writes events, stage transitions, questions, evidence, reviews, confidence, plans, checkpoints, PR/onboarding results, and consumes pending inputs through `@foundry/control` ([route.ts:actions]).

## Verification

- Run: `pnpm test`
