# Handoff brief: Add image uploading support in 'Message the agent' of job detail page

Stage reached: **implementing** · harness: claude-code · updated 2026-11-10T14:50:08.199Z

## Plan

## Ticket #79 — image uploads in "Message the agent"

### Findings
- Composer is a plain server-action `<form>` at `apps/web/src/app/(panel)/jobs/[id]/page.tsx:189` → `messageAction` (`apps/web/src/app/actions.ts:113`) → `sendMessage` (`packages/control/src/jobs.ts:331`) → `job_inputs` table → runner `inputs` API → `renderInputs` text sent to the harness.
- Artifacts (`storeArtifact`/`artifactUrl`) already provide long-lived signed URLs and `.foundry-local/` is the runner's git-excluded scratch dir (`workspace.ts:8`), so uploaded images can be materialized into the worktree where the agent can Read them.
- `PendingInputSchema` (`packages/shared/src/api.ts:77`) has no attachments today.

### Plan
1. **DB** — add `job_inputs.attachments jsonb NOT NULL DEFAULT '[]'` to `packages/db/src/schema.ts` plus migration `0009_job_input_attachments.sql`.
2. **Shared** — add `InputAttachmentSchema` (`artifactId`, `name`, `contentType`, `url`) and optional `attachments` on `PendingInputSchema`.
3. **Control** — `addInput` persists attachments; `takePendingInputs`/`listPendingInputs` return them; `sendMessage(ctx, jobId, text, by, attachmentIds?)` verifies the artifacts belong to the job/team, builds signed URLs, and notes the image names in the timeline event.
4. **Web** — extend `messageAction` to accept `images` File entries, validate count/type/size (max 5 × 5 MB, PNG/JPEG/WebP), store them as job artifacts, then send; raise the Next server-action body limit. Add a client `MessageComposer` (multiple file picker, clipboard paste of images, previews, remove-before-send, pending/error states) and use it on the job page.
5. **Runner** — before starting/resuming the harness, download each pending-input attachment into `.foundry-local/attachments/` and append the local paths to the message text so the agent can view them with Read; fall back to the URL and log a warning if a download fails.
6. **Tests** — control test: sendMessage with an artifact → takePendingInputs carries the attachment/URL. Runner test: attached image is downloaded into the worktree and named in the resume prompt. Then run `run_checks`.

Files: `packages/db/src/schema.ts`, `packages/db/migrations/0009_job_input_attachments.sql`, `packages/shared/src/api.ts`, `packages/control/src/jobs.ts`, `packages/control/src/control.test.ts`, `apps/web/src/app/actions.ts`, `apps/web/next.config.ts`, `apps/web/src/app/(panel)/jobs/[id]/page.tsx`, `apps/web/src/app/(panel)/jobs/[id]/message-composer.tsx`, `apps/runner/src/job-runner.ts`, `apps/runner/src/job-runner.test.ts`.

## Findings

- triage: Ticket #79 asks for image upload support in the "Message the agent" section of the job detail page: multiple images, removal before send, clipboard paste, and delivery to the coding agent. Acceptance criteria are concrete and the change is confined to the panel UI plus the message/agent plumbing.
- investigating: Mapped the message path from the panel form through job_inputs and the runner's pending-input API to the harness. The plan adds attachments to job_inputs/PendingInput, stores uploads as job artifacts, materializes them into the runner worktree, and replaces the form with a client composer supporting multi-select, paste, previews and removal.
- implementing: Recipe checks (lint, typecheck, full test suite) all passed. Control-plane attachment tests were additionally run against a throwaway Postgres (22 passed), and the UI was exercised in a live dev server: multiple attach, preview, remove, clipboard paste, send, timeline entry and composer reset, with screenshots attached as evidence.
- implementing: Pulled origin/main (independent code-review stage) and resolved the two conflicts: the sticky-resume message now combines materialized pending-input attachments with the reviewer's extra message, and the image-attachment runner test was adapted to the new implement/review/finish turn sequence. Also compiled and fixed the auto-merged files. Implementation is complete.

## Checks

- lint: passed
- typecheck: passed
- test: passed

## Questions and answers

_none_

## Open uncertainties

- The runner downloads images from the signed artifact URL (control-plane public URL). If that URL is unreachable from a runner, the job logs a warning and falls back to giving the agent the URL rather than failing the run.

```json
{
  "version": 1,
  "jobId": "115fcd18-e85a-412f-887b-8a1b18619b8a",
  "title": "Add image uploading support in 'Message the agent' of job detail page",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "0e65c91c-4db1-4248-b7c7-98c50c2ac54c",
  "plan": "## Ticket #79 — image uploads in \"Message the agent\"\n\n### Findings\n- Composer is a plain server-action `<form>` at `apps/web/src/app/(panel)/jobs/[id]/page.tsx:189` → `messageAction` (`apps/web/src/app/actions.ts:113`) → `sendMessage` (`packages/control/src/jobs.ts:331`) → `job_inputs` table → runner `inputs` API → `renderInputs` text sent to the harness.\n- Artifacts (`storeArtifact`/`artifactUrl`) already provide long-lived signed URLs and `.foundry-local/` is the runner's git-excluded scratch dir (`workspace.ts:8`), so uploaded images can be materialized into the worktree where the agent can Read them.\n- `PendingInputSchema` (`packages/shared/src/api.ts:77`) has no attachments today.\n\n### Plan\n1. **DB** — add `job_inputs.attachments jsonb NOT NULL DEFAULT '[]'` to `packages/db/src/schema.ts` plus migration `0009_job_input_attachments.sql`.\n2. **Shared** — add `InputAttachmentSchema` (`artifactId`, `name`, `contentType`, `url`) and optional `attachments` on `PendingInputSchema`.\n3. **Control** — `addInput` persists attachments; `takePendingInputs`/`listPendingInputs` return them; `sendMessage(ctx, jobId, text, by, attachmentIds?)` verifies the artifacts belong to the job/team, builds signed URLs, and notes the image names in the timeline event.\n4. **Web** — extend `messageAction` to accept `images` File entries, validate count/type/size (max 5 × 5 MB, PNG/JPEG/WebP), store them as job artifacts, then send; raise the Next server-action body limit. Add a client `MessageComposer` (multiple file picker, clipboard paste of images, previews, remove-before-send, pending/error states) and use it on the job page.\n5. **Runner** — before starting/resuming the harness, download each pending-input attachment into `.foundry-local/attachments/` and append the local paths to the message text so the agent can view them with Read; fall back to the URL and log a warning if a download fails.\n6. **Tests** — control test: sendMessage with an artifact → takePendingInputs carries the attachment/URL. Runner test: attached image is downloaded into the worktree and named in the resume prompt. Then run `run_checks`.\n\nFiles: `packages/db/src/schema.ts`, `packages/db/migrations/0009_job_input_attachments.sql`, `packages/shared/src/api.ts`, `packages/control/src/jobs.ts`, `packages/control/src/control.test.ts`, `apps/web/src/app/actions.ts`, `apps/web/next.config.ts`, `apps/web/src/app/(panel)/jobs/[id]/page.tsx`, `apps/web/src/app/(panel)/jobs/[id]/message-composer.tsx`, `apps/runner/src/job-runner.ts`, `apps/runner/src/job-runner.test.ts`.",
  "findings": [
    "triage: Ticket #79 asks for image upload support in the \"Message the agent\" section of the job detail page: multiple images, removal before send, clipboard paste, and delivery to the coding agent. Acceptance criteria are concrete and the change is confined to the panel UI plus the message/agent plumbing.",
    "investigating: Mapped the message path from the panel form through job_inputs and the runner's pending-input API to the harness. The plan adds attachments to job_inputs/PendingInput, stores uploads as job artifacts, materializes them into the runner worktree, and replaces the form with a client composer supporting multi-select, paste, previews and removal.",
    "implementing: Recipe checks (lint, typecheck, full test suite) all passed. Control-plane attachment tests were additionally run against a throwaway Postgres (22 passed), and the UI was exercised in a live dev server: multiple attach, preview, remove, clipboard paste, send, timeline entry and composer reset, with screenshots attached as evidence.",
    "implementing: Pulled origin/main (independent code-review stage) and resolved the two conflicts: the sticky-resume message now combines materialized pending-input attachments with the reviewer's extra message, and the image-attachment runner test was adapted to the new implement/review/finish turn sequence. Also compiled and fixed the auto-merged files. Implementation is complete."
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
    "The runner downloads images from the signed artifact URL (control-plane public URL). If that URL is unreachable from a runner, the job logs a warning and falls back to giving the agent the URL rather than failing the run."
  ],
  "updatedAt": "2026-11-10T14:50:08.199Z"
}
```
