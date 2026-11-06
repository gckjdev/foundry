-- Realtime: every change to these tables sends {table, id, team_id, op} on channel foundry_changes.
-- Only ids go over NOTIFY (8 KB payload limit); clients fetch rows through the API.
CREATE OR REPLACE FUNCTION foundry_notify_change() RETURNS trigger AS $$
DECLARE
  rec record;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;
  PERFORM pg_notify(
    'foundry_changes',
    json_build_object('table', TG_TABLE_NAME, 'id', rec.id::text, 'team_id', rec.team_id::text, 'op', TG_OP)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jobs_notify AFTER INSERT OR UPDATE OR DELETE ON jobs
  FOR EACH ROW EXECUTE FUNCTION foundry_notify_change();
--> statement-breakpoint
CREATE TRIGGER events_notify AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION foundry_notify_change();
--> statement-breakpoint
CREATE TRIGGER questions_notify AFTER INSERT OR UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION foundry_notify_change();
--> statement-breakpoint
CREATE TRIGGER runners_notify AFTER INSERT OR UPDATE ON runners
  FOR EACH ROW EXECUTE FUNCTION foundry_notify_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jobs_touch BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION foundry_touch_updated_at();
