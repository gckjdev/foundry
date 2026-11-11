ALTER TABLE "jobs" ADD COLUMN "pr_review_sha" text;
ALTER TABLE "jobs" ADD COLUMN "pr_review_count" integer NOT NULL DEFAULT 0;
