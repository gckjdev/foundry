ALTER TABLE "jobs" ADD COLUMN "reverted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pr_title" text;