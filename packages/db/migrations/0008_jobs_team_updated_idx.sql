-- Board and inbox both list a team's jobs newest-first. Without this index Postgres fetches every
-- job row for the team and sorts it; the existing (team_id, status) index cannot supply the order.
CREATE INDEX "jobs_team_updated_idx" ON "jobs" USING btree ("team_id","updated_at");
