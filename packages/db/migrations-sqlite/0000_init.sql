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
	"confidence" text,
	"gate_result" text,
	"assigned_reviewers" text DEFAULT '[]' NOT NULL,
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
	"op" text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER "jobs_changes_insert" AFTER INSERT ON "jobs"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('jobs', CAST(NEW."id" AS TEXT), NEW."team_id", 'INSERT');
END;
--> statement-breakpoint
CREATE TRIGGER "jobs_changes_update" AFTER UPDATE ON "jobs"
FOR EACH ROW
BEGIN
	INSERT INTO "_foundry_changes" ("table", "id", "team_id", "op")
	VALUES ('jobs', CAST(NEW."id" AS TEXT), NEW."team_id", 'UPDATE');
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
