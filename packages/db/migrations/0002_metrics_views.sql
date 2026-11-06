-- Metrics (spec 5.11). One row per job with everything the metrics page slices on.
CREATE OR REPLACE VIEW metrics_job_facts AS
SELECT
  j.id,
  j.team_id,
  j.repo_id,
  j.kind,
  j.harness,
  j.model,
  j.author_user_id,
  j.author_login,
  j.status,
  j.cost_usd,
  j.created_at,
  j.claimed_at,
  j.finished_at,
  j.reverted_at,
  r.os AS origin_os,
  j.resume_count,
  EXTRACT(EPOCH FROM (j.finished_at - j.created_at)) / 60 AS lead_time_min,
  EXTRACT(EPOCH FROM (j.claimed_at - j.created_at)) / 60 AS first_queue_min,
  EXISTS (
    SELECT 1 FROM events e WHERE e.job_id = j.id AND e.kind = 'stage_changed' AND e.payload->>'to' = 'pr_ci'
  ) AS reached_pr,
  (j.status = 'merged' AND EXISTS (
    SELECT 1 FROM events e WHERE e.job_id = j.id AND e.kind = 'stage_changed'
      AND e.payload->>'to' = 'merged' AND e.payload->>'reason' = 'confidence gate passed'
  )) AS auto_merged,
  (
    SELECT count(*) FROM events e WHERE e.job_id = j.id
      AND (e.kind = 'answer' OR (e.kind = 'message' AND e.payload->>'role' = 'human'))
  ) + CASE WHEN j.status = 'merged' AND NOT EXISTS (
    SELECT 1 FROM events e WHERE e.job_id = j.id AND e.kind = 'stage_changed'
      AND e.payload->>'to' = 'merged' AND e.payload->>'reason' = 'confidence gate passed'
  ) THEN 1 ELSE 0 END AS human_touches,
  EXISTS (
    SELECT 1 FROM events e WHERE e.job_id = j.id AND e.kind = 'stage_changed'
      AND e.payload->>'to' = 'queued' AND e.payload->>'reason' LIKE 'runner % offline'
  ) AS requeued_offline,
  EXISTS (
    SELECT 1 FROM events e WHERE e.job_id = j.id AND e.kind = 'resumed' AND e.payload->>'mode' = 'portable'
  ) AS portable_resumed
FROM jobs j
LEFT JOIN runners r ON r.id = j.origin_runner_id;
--> statement-breakpoint
-- How long each handover waited before someone acted (left waiting_on_you).
CREATE OR REPLACE VIEW metrics_handover_waits AS
SELECT
  e.job_id,
  e.team_id,
  e.ts AS handed_at,
  (
    SELECT min(n.ts) FROM events n
    WHERE n.job_id = e.job_id AND n.kind = 'stage_changed' AND n.id > e.id AND n.payload->>'from' = 'waiting_on_you'
  ) AS acted_at
FROM events e
WHERE e.kind = 'stage_changed' AND e.payload->>'to' = 'waiting_on_you';
--> statement-breakpoint
-- Busy intervals per runner: from claim (stage_changed out of queued) to the next stage change
-- that releases the job (queued, needs_input, pr_ci, failed, cancelled).
CREATE OR REPLACE VIEW metrics_runner_busy AS
SELECT
  ru.id AS runner_id,
  e.team_id,
  e.ts AS started_at,
  coalesce((
    SELECT min(n.ts) FROM events n
    WHERE n.job_id = e.job_id AND n.kind = 'stage_changed' AND n.id > e.id
      AND n.payload->>'to' IN ('queued', 'needs_input', 'pr_ci', 'failed', 'cancelled')
  ), now()) AS ended_at
FROM events e
JOIN runners ru ON ru.team_id = e.team_id AND ru.name = substring(e.payload->>'reason' FROM '^claimed by (.*)$')
WHERE e.kind = 'stage_changed' AND e.payload->>'from' = 'queued';
