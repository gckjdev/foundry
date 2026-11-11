# Handoff brief: Add db design doc

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-11T07:48:27.495Z

## Plan

## Plan — Add database design document

1. **Create `docs/design/database.md`** (English source of truth reference):
   - Scope and conventions: `packages/db/src/schema.ts` is authoritative; migrations under `packages/db/migrations`; Postgres 16+; UUID PKs, `timestamptz`, text-backed enums, snake_case, team scoping, append-only events.
   - Entity-relationship overview (mermaid `erDiagram`) grouped by identity, repos/runners, jobs, timeline/evidence, ingest/notifications.
   - Per-table data dictionary: every column with type, nullable, default and meaning; primary/unique keys, foreign keys and `ON DELETE` behavior; indexes.
   - Enum reference: job statuses (link `packages/shared/src/states.ts`), job kind/source/playbook, runner kind/status/os, onboarding status, merge mode, notification preferences/channels, evidence kinds/statuses, event kinds, question answer channels.
   - JSONB shapes with examples: `jobs.confidence`, `jobs.gate_result`, `jobs.assigned_reviewers`, `runners.harnesses`, `job_inputs.attachments`, `events.payload`.
   - Index catalog (name, table, columns, uniqueness/partial predicate, why it exists).
   - Constraints/invariants: team scoping, one live job per issue, immutable events, `webhook_inbox` idempotency.
   - Triggers/functions: `foundry_notify_change` (payload, changed-columns behavior, 8 KB limit), `foundry_touch_updated_at`; realtime trigger tables.
   - Reporting views: `metrics_job_facts`, `metrics_handover_waits`, `metrics_runner_busy` with columns and a sample query.
   - Worked examples: job lifecycle rows, claim query with `FOR UPDATE SKIP LOCKED`, board/query examples, event JSON.
   - Migration workflow: edit `schema.ts`, generate SQL/meta with drizzle-kit, hand-edit for triggers/views, custom `_foundry_migrations` runner, per-file transaction, ISO timestamptz convention, tests.
2. **Create `docs/design/database.zh-CN.md`** — a faithful Chinese counterpart (repo convention: every human-facing doc has one).
3. **Update `docs/design/overall-design.md` (§2.5 Data model) and `.zh-CN.md`** — link the new doc as the detailed reference.
4. **Update `docs/design/components.md` (§6 `packages/db`) and `.zh-CN.md`** — point at the data dictionary.
5. **Update `README.md` and `README.zh-CN.md` documentation tables** — add a "Database design / 数据库设计" row linking both versions.
6. **Update `AGENTS.md` "Where to look"** — add a "Database schema / data dictionary" row.
7. Verify with `pnpm exec biome check` on touched files (docs are ignored by Biome but run it for the repo), and `run_checks` for lint/typecheck/tests. No code changes, no new tests needed.

## Findings

- triage: Ticket #83 is clear: add a database design document covering the data dictionary, indexes, table descriptions and examples, and update related docs. Goal and acceptance criteria are unambiguous, so I am moving to investigating the schema, migrations and existing docs conventions.
- investigating: The schema is fully mapped: 15 tables, their columns/defaults/keys, all indexes from schema.ts plus migration 0008, FK delete behavior, NOTIFY/touch triggers, the three metrics views, and JSONB shapes (confidence, gate result, harnesses, attachments, events). Docs conventions confirmed: every human-facing doc has an English and Chinese version, and README tables index them. Starting implementation.
- implementing: Added `docs/design/database.md` (and Chinese counterpart) covering all 15 tables with per-column dictionaries, keys/FKs/delete behavior, index catalog, enum values, JSONB shapes, triggers/NOTIFY payloads, reporting views, worked SQL/JSON examples, and the migration workflow. Linked it from the two READMEs, overall-design §2.5, components §6, and AGENTS.md's "Where to look" table (English and Chinese docs kept in sync). Requesting review.
- review: Reviewed the docs-only diff (9 files, +1819/-1). I verified the new data dictionary column-by-column against `packages/db/src/schema.ts` (all 15 tables, 268 column rows, every default and ON DELETE behavior match), and cross-checked the migrations, `packages/shared/src/states.ts`, `events.ts`/`gate.ts`/`api.ts`, claim/ingest/notify/merge-gate, the metrics views, and the runner loop count. The index catalog, enum reference, JSONB shapes, trigger/NOTIFY payloads (including the `updated_at`-always-in-columns reasoning and the 120 s heartbeat re-queue), reporting views, claim SQL and migration workflow all match the implementation. The zh-CN counterpart is structurally identical (same headings, 15 tables, 268 column rows, same link targets) and both READMEs, overall-design §2.5, components §6 and AGENTS.md "Where to look" are updated consistently in both languages. Table markup is well-formed and all relative links resolve; no tests apply to a docs change. No UI files or user-facing behavior changed, so UI design did not apply. Security: no secrets or code paths touched; the doc's "no plaintext secrets" statement (token hashes, short-lived GitHub tokens) matches the code. Remaining items are small accuracy/discoverability nits, none blocking.
- reviewing: The independent reviewer approved the database design document and its cross-doc updates. Moving to verification; this is a docs-only change, so I will run the repository recipe checks (lint, typecheck, tests) and then report confidence.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "31267480-62f6-42a1-96bc-93f488242319",
  "title": "Add db design doc",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "577bbae2-8ad8-4899-a330-746464072f6a",
  "plan": "## Plan — Add database design document\n\n1. **Create `docs/design/database.md`** (English source of truth reference):\n   - Scope and conventions: `packages/db/src/schema.ts` is authoritative; migrations under `packages/db/migrations`; Postgres 16+; UUID PKs, `timestamptz`, text-backed enums, snake_case, team scoping, append-only events.\n   - Entity-relationship overview (mermaid `erDiagram`) grouped by identity, repos/runners, jobs, timeline/evidence, ingest/notifications.\n   - Per-table data dictionary: every column with type, nullable, default and meaning; primary/unique keys, foreign keys and `ON DELETE` behavior; indexes.\n   - Enum reference: job statuses (link `packages/shared/src/states.ts`), job kind/source/playbook, runner kind/status/os, onboarding status, merge mode, notification preferences/channels, evidence kinds/statuses, event kinds, question answer channels.\n   - JSONB shapes with examples: `jobs.confidence`, `jobs.gate_result`, `jobs.assigned_reviewers`, `runners.harnesses`, `job_inputs.attachments`, `events.payload`.\n   - Index catalog (name, table, columns, uniqueness/partial predicate, why it exists).\n   - Constraints/invariants: team scoping, one live job per issue, immutable events, `webhook_inbox` idempotency.\n   - Triggers/functions: `foundry_notify_change` (payload, changed-columns behavior, 8 KB limit), `foundry_touch_updated_at`; realtime trigger tables.\n   - Reporting views: `metrics_job_facts`, `metrics_handover_waits`, `metrics_runner_busy` with columns and a sample query.\n   - Worked examples: job lifecycle rows, claim query with `FOR UPDATE SKIP LOCKED`, board/query examples, event JSON.\n   - Migration workflow: edit `schema.ts`, generate SQL/meta with drizzle-kit, hand-edit for triggers/views, custom `_foundry_migrations` runner, per-file transaction, ISO timestamptz convention, tests.\n2. **Create `docs/design/database.zh-CN.md`** — a faithful Chinese counterpart (repo convention: every human-facing doc has one).\n3. **Update `docs/design/overall-design.md` (§2.5 Data model) and `.zh-CN.md`** — link the new doc as the detailed reference.\n4. **Update `docs/design/components.md` (§6 `packages/db`) and `.zh-CN.md`** — point at the data dictionary.\n5. **Update `README.md` and `README.zh-CN.md` documentation tables** — add a \"Database design / 数据库设计\" row linking both versions.\n6. **Update `AGENTS.md` \"Where to look\"** — add a \"Database schema / data dictionary\" row.\n7. Verify with `pnpm exec biome check` on touched files (docs are ignored by Biome but run it for the repo), and `run_checks` for lint/typecheck/tests. No code changes, no new tests needed.",
  "findings": [
    "triage: Ticket #83 is clear: add a database design document covering the data dictionary, indexes, table descriptions and examples, and update related docs. Goal and acceptance criteria are unambiguous, so I am moving to investigating the schema, migrations and existing docs conventions.",
    "investigating: The schema is fully mapped: 15 tables, their columns/defaults/keys, all indexes from schema.ts plus migration 0008, FK delete behavior, NOTIFY/touch triggers, the three metrics views, and JSONB shapes (confidence, gate result, harnesses, attachments, events). Docs conventions confirmed: every human-facing doc has an English and Chinese version, and README tables index them. Starting implementation.",
    "implementing: Added `docs/design/database.md` (and Chinese counterpart) covering all 15 tables with per-column dictionaries, keys/FKs/delete behavior, index catalog, enum values, JSONB shapes, triggers/NOTIFY payloads, reporting views, worked SQL/JSON examples, and the migration workflow. Linked it from the two READMEs, overall-design §2.5, components §6, and AGENTS.md's \"Where to look\" table (English and Chinese docs kept in sync). Requesting review.",
    "review: Reviewed the docs-only diff (9 files, +1819/-1). I verified the new data dictionary column-by-column against `packages/db/src/schema.ts` (all 15 tables, 268 column rows, every default and ON DELETE behavior match), and cross-checked the migrations, `packages/shared/src/states.ts`, `events.ts`/`gate.ts`/`api.ts`, claim/ingest/notify/merge-gate, the metrics views, and the runner loop count. The index catalog, enum reference, JSONB shapes, trigger/NOTIFY payloads (including the `updated_at`-always-in-columns reasoning and the 120 s heartbeat re-queue), reporting views, claim SQL and migration workflow all match the implementation. The zh-CN counterpart is structurally identical (same headings, 15 tables, 268 column rows, same link targets) and both READMEs, overall-design §2.5, components §6 and AGENTS.md \"Where to look\" are updated consistently in both languages. Table markup is well-formed and all relative links resolve; no tests apply to a docs change. No UI files or user-facing behavior changed, so UI design did not apply. Security: no secrets or code paths touched; the doc's \"no plaintext secrets\" statement (token hashes, short-lived GitHub tokens) matches the code. Remaining items are small accuracy/discoverability nits, none blocking.",
    "reviewing: The independent reviewer approved the database design document and its cross-doc updates. Moving to verification; this is a docs-only change, so I will run the repository recipe checks (lint, typecheck, tests) and then report confidence."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-11T07:48:27.495Z"
}
```
