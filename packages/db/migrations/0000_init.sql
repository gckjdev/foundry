CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"job_id" uuid,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"stage" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"command" text,
	"exit_code" integer,
	"output_tail" text,
	"duration_ms" integer,
	"artifact_id" uuid,
	"loop" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"gh_login" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"by" text NOT NULL,
	"question_prompt" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"kind" text DEFAULT 'ticket' NOT NULL,
	"author_user_id" uuid,
	"author_login" text,
	"source" text DEFAULT 'github_issue' NOT NULL,
	"issue_number" integer,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"playbook" text DEFAULT 'default' NOT NULL,
	"harness" text NOT NULL,
	"model" text,
	"pinned_runner_name" text,
	"runner_id" uuid,
	"origin_runner_id" uuid,
	"sticky_runner_id" uuid,
	"sticky_until" timestamp with time zone,
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
	"ui_changed" boolean DEFAULT false NOT NULL,
	"changed_lines" integer DEFAULT 0 NOT NULL,
	"plan" text,
	"confidence" jsonb,
	"gate_result" jsonb,
	"assigned_reviewers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status_comment_id" integer,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid,
	"job_id" uuid,
	"event" text NOT NULL,
	"detail" text NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"asked_user_id" uuid,
	"asked_login" text,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer" text,
	"answer_option_index" integer,
	"answered_by" text,
	"answered_via" text,
	"gh_comment_id" integer,
	"helpful" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"gh_installation_id" integer NOT NULL,
	"gh_repo_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"gh_project_id" text,
	"default_harness" text,
	"default_model" text,
	"merge_mode" text DEFAULT 'off' NOT NULL,
	"accepts_jobs" boolean DEFAULT false NOT NULL,
	"recipe_sha" text,
	"recipe_yaml" text,
	"policy_yaml" text,
	"onboarding_status" text DEFAULT 'not_started' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_repo_readiness" (
	"runner_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"recipe_sha" text,
	"ready" boolean NOT NULL,
	"reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_repo_readiness_runner_id_repo_id_pk" PRIMARY KEY("runner_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"os_version" text NOT NULL,
	"token_hash" text NOT NULL,
	"version" text,
	"last_seen_at" timestamp with time zone,
	"cpu" integer,
	"mem_mb" integer,
	"disk_free_mb" integer,
	"on_ac_power" boolean,
	"accepting" boolean DEFAULT true NOT NULL,
	"not_accepting_reason" text,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"harnesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"gh_org" text,
	"daily_spend_cap_usd" double precision,
	"outgoing_webhook_url" text,
	"default_harness" text DEFAULT 'claude-code' NOT NULL,
	"default_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"gh_login" text NOT NULL,
	"gh_id" integer,
	"name" text,
	"avatar_url" text,
	"notify_pref" text DEFAULT 'github' NOT NULL,
	"push_subscription" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_inputs" ADD CONSTRAINT "job_inputs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_origin_runner_id_runners_id_fk" FOREIGN KEY ("origin_runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_sticky_runner_id_runners_id_fk" FOREIGN KEY ("sticky_runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_asked_user_id_users_id_fk" FOREIGN KEY ("asked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_repo_readiness" ADD CONSTRAINT "runner_repo_readiness_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_repo_readiness" ADD CONSTRAINT "runner_repo_readiness_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_job_idx" ON "events" USING btree ("job_id","id");--> statement-breakpoint
CREATE INDEX "events_team_ts_idx" ON "events" USING btree ("team_id","ts");--> statement-breakpoint
CREATE INDEX "jobs_team_status_idx" ON "jobs" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "jobs_runner_idx" ON "jobs" USING btree ("runner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_issue_active_idx" ON "jobs" USING btree ("repo_id","issue_number") WHERE status not in ('merged','cancelled') and issue_number is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "repos_gh_repo_idx" ON "repos" USING btree ("gh_repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_token_idx" ON "runners" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_team_name_idx" ON "runners" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_gh_login_idx" ON "users" USING btree ("gh_login");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_delivery_idx" ON "webhook_inbox" USING btree ("provider","delivery_id");