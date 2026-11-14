# web/src/app/(panel)/jobs/[id]

## Overview

The job detail page shows one job's status, runner, cost, elapsed time, retry and
cancel controls, an open-question answer form, a timeline, a message composer,
evidence cards, the confidence gate, and a polling live log.

## Interface

- Default export `JobPage({ params })` — loads `jobDetail(ctx, team.id, id)`, returns `notFound()` when missing ([page.tsx:JobPage]).
- `live-log-lines.ts` — `Line`, `mergeLines(prev, incoming)`, `needsServerRefresh(events)` ([live-log-lines.ts]).
- `live-log.tsx` — `LiveLog({ jobId, initial, after })`, polling `/api/jobs/<id>/events?after=` every 2 s ([live-log.tsx:LiveLog]).
- `message-composer.tsx` — client `MessageComposer({ jobId })` with text plus up to five pasted/picked images ([message-composer.tsx:MessageComposer]).
- Subdirectory: configuration: [./configuration/EGM.md](./configuration/EGM.md) — per-job time and cost limits.
- Server actions are imported from `../../../actions`: `answerAction`, `cancelAction`, `helpfulAction`, `retryAction` ([page.tsx:JobPage]).

## Invariants

- Timeline renders only `TIMELINE_KINDS`; live log renders everything else ([page.tsx:TIMELINE_KINDS], [live-log-lines.ts:LOG_ONLY_KINDS]).
- The initial log is the last 200 timeline rows, and polling starts after the last row id ([page.tsx:JobPage]).
- `mergeLines` drops already-seen ids and caps the buffer at 1000 lines, so React Strict Mode's double effect cannot duplicate keys ([live-log-lines.ts:mergeLines]).
- `needsServerRefresh` is true for evidence and any non-log-only kind, and for human messages; agent messages and tool/usage/log/subagent events stay log-only ([live-log-lines.ts:needsServerRefresh]).
- The composer accepts only PNG/JPEG/WebP up to 5 MB, at most 5 images; object URLs are revoked on remove/unmount ([message-composer.tsx:MessageComposer]).
- Retry defaults the stage to `job.resumeStage` when the last completed stage exists, else `triage`; retry options are `RUNNER_STAGES` plus `POST_PR_REVIEW_STAGE` ([page.tsx:JobPage]).
- Cancel is hidden once a job is `merged` or `cancelled` ([page.tsx:JobPage]).
- The answer form only renders for the first unanswered question and accepts either an option index or free text ([page.tsx:JobPage], [actions.ts:answerAction]).

## Side Effects

- Polls the incremental events endpoint and may call `router.refresh()` when a poll reveals server-rendered content ([live-log.tsx:LiveLog]).
- Answer/helpful/retry/cancel forms invoke server actions that write to the DB and revalidate the page ([actions.ts]).
- Sending a message uploads images as artifacts and records the message ([actions.ts:messageAction]).
- Evidence images are loaded from signed artifact URLs ([page.tsx:JobPage]).

## Verification

- Run: `pnpm test`
