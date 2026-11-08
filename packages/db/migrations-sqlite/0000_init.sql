-- Final SQLite schema, mirroring migrations/0000_init.sql..0003 plus the notify/updated_at triggers.
-- UUIDs are 32-hex text, timestamps are integer milliseconds, json is TEXT, booleans are 0/1.
CREATE TABLE "teams" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"name" text NOT NULL,
	"gh_org" text,
	"daily_spend_cap_usd" real,
	"outgoing_webhook_url" text,
	"default_harness" text DEFAULT 'claude-code' NOT NULL,
	"default_model" text,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"email" text,
	"gh_login" text NOT NULL,
	"gh_id" integer,
	"name" text,
	"avatar_url" text,
	"notify_pref" text DEFAULT 'github' NOT NULL,
	"push_subscription" text,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY ("team_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"gh_login" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"gh_installation_id" integer NOT NULL,
	"gh_repo_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"gh_project_id" text,
	"default_harness" text,
	"default_model" text,
	"merge_mode" text DEFAULT 'off' NOT NULL,
	"accepts_jobs" integer DEFAULT 0 NOT NULL,
	"recipe_sha" text,
	"recipe_yaml" text,
	"policy_yaml" text,
	"onboarding_status" text DEFAULT 'not_started' NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"owner_user_id" text REFERENCES "users"("id") ON DELETE set null,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"os_version" text NOT NULL,
	"token_hash" text NOT NULL,
	"version" text,
	"last_seen_at" integer,
	"cpu" integer,
	"mem_mb" integer,
	"disk_free_mb" integer,
	"on_ac_power" integer,
	"accepting" integer DEFAULT 1 NOT NULL,
	"not_accepting_reason" text,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"harnesses" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_repo_readiness" (
	"runner_id" text NOT NULL REFERENCES "runners"("id") ON DELETE cascade,
	"repo_id" text NOT NULL REFERENCES "repos"("id") ON DELETE cascade,
	"recipe_sha" text,
	"ready" integer NOT NULL,
	"reason" text,
	"checked_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY ("runner_id", "repo_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"repo_id" text NOT NULL REFERENCES "repos"("id") ON DELETE cascade,
	"kind" text DEFAULT 'ticket' NOT NULL,
	"author_user_id" text REFERENCES "users"("id") ON DELETE set null,
	"author_login" text,
	"source" text DEFAULT 'github_issue' NOT NULL,
	"issue_number" integer,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"playbook" text DEFAULT 'default' NOT NULL,
	"harness" text NOT NULL,
	"model" text,
	"pinned_runner_name" text,
	"runner_id" text REFERENCES "runners"("id") ON DELETE set null,
	"origin_runner_id" text REFERENCES "runners"("id") ON DELETE set null,
	"sticky_runner_id" text REFERENCES "runners"("id") ON DELETE set null,
	"sticky_until" integer,
	"worktree_path" text,
	"port_base" integer,
	"harness_session_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"resume_stage" text DEFAULT 'triage' NOT NULL,
	"last_completed_stage" text,
	"brief_ref" text,
	"resume_count" integer DEFAULT 0 NOT NULL,
	"loop_count" integer DEFAULT 0 NOT NULL,
	"branch" text NOT NULL,
	"head_sha" text,
	"pr_number" integer,
	"pr_url" text,
	"ci_status" text DEFAULT 'none' NOT NULL,
	"ai_review_status" text DEFAULT 'none' NOT NULL,
	"ui_changed" integer DEFAULT 0 NOT NULL,
	"changed_lines" integer DEFAULT 0 NOT NULL,
	"plan" text,
	"max_job_minutes" integer,
	"max_cost_usd" real,
	"confidence" text,
	"gate_result" text,
	"assigned_reviewers" text DEFAULT '[]' NOT NULL,
	"last_review_id" integer,
	"status_comment_id" integer,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	"claimed_at" integer,
	"started_at" integer,
	"finished_at" integer,
	"reverted_at" integer,
	"pr_title" text,
	"updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"job_id" text NOT NULL REFERENCES "jobs"("id") ON DELETE cascade,
	"team_id" text NOT NULL,
	"ts" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	"kind" text NOT NULL,
	"stage" text,
	"payload" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"job_id" text NOT NULL REFERENCES "jobs"("id") ON DELETE cascade,
	"team_id" text NOT NULL,
	"asked_user_id" text REFERENCES "users"("id") ON DELETE set null,
	"asked_login" text,
	"prompt" text NOT NULL,
	"options" text DEFAULT '[]' NOT NULL,
	"answer" text,
	"answer_option_index" integer,
	"answered_by" text,
	"answered_via" text,
	"gh_comment_id" integer,
	"helpful" integer,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	"answered_at" integer
);
--> statement-breakpoint
CREATE TABLE "job_inputs" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"job_id" text NOT NULL REFERENCES "jobs"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"by" text NOT NULL,
	"question_prompt" text,
	"delivered_at" integer,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"job_id" text NOT NULL REFERENCES "jobs"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"command" text,
	"exit_code" integer,
	"output_tail" text,
	"duration_ms" integer,
	"artifact_id" text,
	"loop" integer DEFAULT 0 NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"team_id" text NOT NULL,
	"job_id" text REFERENCES "jobs"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"provider" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" text NOT NULL,
	"received_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	"processed_at" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text REFERENCES "users"("id") ON DELETE cascade,
	"job_id" text REFERENCES "jobs"("id") ON DELETE cascade,
	"event" text NOT NULL,
	"detail" text NOT NULL,
	"channel" text NOT NULL,
	"sent_at" integer,
	"error" text,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_job_idx" ON "events" ("job_id", "id");
--> statement-breakpoint
CREATE INDEX "events_team_ts_idx" ON "events" ("team_id", "ts");
--> statement-breakpoint
CREATE INDEX "jobs_team_status_idx" ON "jobs" ("team_id", "status");
--> statement-breakpoint
CREATE INDEX "jobs_runner_idx" ON "jobs" ("runner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_issue_active_idx" ON "jobs" ("repo_id", "issue_number") WHERE status not in ('merged','cancelled') and issue_number is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "repos_gh_repo_idx" ON "repos" ("gh_repo_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "runners_token_idx" ON "runners" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "runners_team_name_idx" ON "runners" ("team_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_gh_login_idx" ON "users" ("gh_login");
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_delivery_idx" ON "webhook_inbox" ("provider", "delivery_id");
--> statement-breakpoint
-- Bump jobs.updated_at on every app-driven UPDATE (the pg schema does this with a BEFORE UPDATE
-- trigger). max(...) keeps it monotonic so the AFTER UPDATE trigger below cannot recurse forever.
CREATE TRIGGER "jobs_touch" AFTER UPDATE ON "jobs"
FOR EACH ROW
WHEN NEW."updated_at" = OLD."updated_at"
BEGIN
	UPDATE "jobs" SET "updated_at" = max(unixepoch() * 1000, OLD."updated_at" + 1) WHERE "id" = OLD."id";
END;
--> statement-breakpoint
-- Realtime change log. The pg driver LISTEN/NOTIFYs; the sqlite realtime process polls this outbox.
-- SQLite triggers fire on a single event, so each {table,event} gets its own trigger.
CREATE TABLE "_foundry_changes" (
	"seq" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"table" text NOT NULL,
	"id" text NOT NULL,
	"team_id" text NOT NULL,
	"op" text NOT NULL,
	"columns" text
);
--> statement-breakpoint
CREATE TRIGGER "jobs_changes_insert" AFTER INSERT ON "jobs"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('jobs', CAST(NEW."id" AS TEXT), NEW."team_id", 'INSERT');
END;
--> statement-breakpoint
-- Mirror the Postgres payload's `columns`: the names of columns whose value actually changed, so
-- clients can ignore cosmetic updates (cost/token counters, the `updated_at` touch). `IS NOT` is
-- SQLite's null-safe "is different from", matching Postgres `IS DISTINCT FROM`.
CREATE TRIGGER "jobs_changes_update" AFTER UPDATE ON "jobs"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op", "columns")
	SELECT
		'jobs',
		CAST(NEW."id" AS TEXT),
		NEW."team_id",
		'UPDATE',
		COALESCE((
			SELECT json_group_array(c) FROM (
				SELECT 'team_id' AS c WHERE NEW."team_id" IS NOT OLD."team_id"
				UNION ALL SELECT 'repo_id' WHERE NEW."repo_id" IS NOT OLD."repo_id"
				UNION ALL SELECT 'kind' WHERE NEW."kind" IS NOT OLD."kind"
				UNION ALL SELECT 'author_user_id' WHERE NEW."author_user_id" IS NOT OLD."author_user_id"
				UNION ALL SELECT 'author_login' WHERE NEW."author_login" IS NOT OLD."author_login"
				UNION ALL SELECT 'source' WHERE NEW."source" IS NOT OLD."source"
				UNION ALL SELECT 'issue_number' WHERE NEW."issue_number" IS NOT OLD."issue_number"
				UNION ALL SELECT 'title' WHERE NEW."title" IS NOT OLD."title"
				UNION ALL SELECT 'body' WHERE NEW."body" IS NOT OLD."body"
				UNION ALL SELECT 'playbook' WHERE NEW."playbook" IS NOT OLD."playbook"
				UNION ALL SELECT 'harness' WHERE NEW."harness" IS NOT OLD."harness"
				UNION ALL SELECT 'model' WHERE NEW."model" IS NOT OLD."model"
				UNION ALL SELECT 'pinned_runner_name' WHERE NEW."pinned_runner_name" IS NOT OLD."pinned_runner_name"
				UNION ALL SELECT 'runner_id' WHERE NEW."runner_id" IS NOT OLD."runner_id"
				UNION ALL SELECT 'origin_runner_id' WHERE NEW."origin_runner_id" IS NOT OLD."origin_runner_id"
				UNION ALL SELECT 'sticky_runner_id' WHERE NEW."sticky_runner_id" IS NOT OLD."sticky_runner_id"
				UNION ALL SELECT 'sticky_until' WHERE NEW."sticky_until" IS NOT OLD."sticky_until"
				UNION ALL SELECT 'worktree_path' WHERE NEW."worktree_path" IS NOT OLD."worktree_path"
				UNION ALL SELECT 'port_base' WHERE NEW."port_base" IS NOT OLD."port_base"
				UNION ALL SELECT 'harness_session_id' WHERE NEW."harness_session_id" IS NOT OLD."harness_session_id"
				UNION ALL SELECT 'status' WHERE NEW."status" IS NOT OLD."status"
				UNION ALL SELECT 'resume_stage' WHERE NEW."resume_stage" IS NOT OLD."resume_stage"
				UNION ALL SELECT 'last_completed_stage' WHERE NEW."last_completed_stage" IS NOT OLD."last_completed_stage"
				UNION ALL SELECT 'brief_ref' WHERE NEW."brief_ref" IS NOT OLD."brief_ref"
				UNION ALL SELECT 'resume_count' WHERE NEW."resume_count" IS NOT OLD."resume_count"
				UNION ALL SELECT 'loop_count' WHERE NEW."loop_count" IS NOT OLD."loop_count"
				UNION ALL SELECT 'branch' WHERE NEW."branch" IS NOT OLD."branch"
				UNION ALL SELECT 'head_sha' WHERE NEW."head_sha" IS NOT OLD."head_sha"
				UNION ALL SELECT 'pr_number' WHERE NEW."pr_number" IS NOT OLD."pr_number"
				UNION ALL SELECT 'pr_url' WHERE NEW."pr_url" IS NOT OLD."pr_url"
				UNION ALL SELECT 'ci_status' WHERE NEW."ci_status" IS NOT OLD."ci_status"
				UNION ALL SELECT 'ai_review_status' WHERE NEW."ai_review_status" IS NOT OLD."ai_review_status"
				UNION ALL SELECT 'ui_changed' WHERE NEW."ui_changed" IS NOT OLD."ui_changed"
				UNION ALL SELECT 'changed_lines' WHERE NEW."changed_lines" IS NOT OLD."changed_lines"
				UNION ALL SELECT 'plan' WHERE NEW."plan" IS NOT OLD."plan"
				UNION ALL SELECT 'max_job_minutes' WHERE NEW."max_job_minutes" IS NOT OLD."max_job_minutes"
				UNION ALL SELECT 'max_cost_usd' WHERE NEW."max_cost_usd" IS NOT OLD."max_cost_usd"
				UNION ALL SELECT 'confidence' WHERE NEW."confidence" IS NOT OLD."confidence"
				UNION ALL SELECT 'gate_result' WHERE NEW."gate_result" IS NOT OLD."gate_result"
				UNION ALL SELECT 'assigned_reviewers' WHERE NEW."assigned_reviewers" IS NOT OLD."assigned_reviewers"
				UNION ALL SELECT 'last_review_id' WHERE NEW."last_review_id" IS NOT OLD."last_review_id"
				UNION ALL SELECT 'status_comment_id' WHERE NEW."status_comment_id" IS NOT OLD."status_comment_id"
				UNION ALL SELECT 'cost_usd' WHERE NEW."cost_usd" IS NOT OLD."cost_usd"
				UNION ALL SELECT 'tokens_in' WHERE NEW."tokens_in" IS NOT OLD."tokens_in"
				UNION ALL SELECT 'tokens_out' WHERE NEW."tokens_out" IS NOT OLD."tokens_out"
				UNION ALL SELECT 'failure_reason' WHERE NEW."failure_reason" IS NOT OLD."failure_reason"
				UNION ALL SELECT 'created_at' WHERE NEW."created_at" IS NOT OLD."created_at"
				UNION ALL SELECT 'claimed_at' WHERE NEW."claimed_at" IS NOT OLD."claimed_at"
				UNION ALL SELECT 'started_at' WHERE NEW."started_at" IS NOT OLD."started_at"
				UNION ALL SELECT 'finished_at' WHERE NEW."finished_at" IS NOT OLD."finished_at"
				UNION ALL SELECT 'reverted_at' WHERE NEW."reverted_at" IS NOT OLD."reverted_at"
				UNION ALL SELECT 'pr_title' WHERE NEW."pr_title" IS NOT OLD."pr_title"
				UNION ALL SELECT 'updated_at' WHERE NEW."updated_at" IS NOT OLD."updated_at"
			)
		), '[]')
	;
END;
--> statement-breakpoint
CREATE TRIGGER "jobs_changes_delete" AFTER DELETE ON "jobs"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('jobs', CAST(OLD."id" AS TEXT), OLD."team_id", 'DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER "events_changes" AFTER INSERT ON "events"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('events', CAST(NEW."id" AS TEXT), NEW."team_id", 'INSERT');
END;
--> statement-breakpoint
CREATE TRIGGER "questions_changes_insert" AFTER INSERT ON "questions"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('questions', CAST(NEW."id" AS TEXT), NEW."team_id", 'INSERT');
END;
--> statement-breakpoint
CREATE TRIGGER "questions_changes_update" AFTER UPDATE ON "questions"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('questions', CAST(NEW."id" AS TEXT), NEW."team_id", 'UPDATE');
END;
--> statement-breakpoint
CREATE TRIGGER "runners_changes_insert" AFTER INSERT ON "runners"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('runners', CAST(NEW."id" AS TEXT), NEW."team_id", 'INSERT');
END;
--> statement-breakpoint
CREATE TRIGGER "runners_changes_update" AFTER UPDATE ON "runners"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('runners', CAST(NEW."id" AS TEXT), NEW."team_id", 'UPDATE');
END;
