ALTER TABLE "job_inputs" ADD COLUMN "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;
