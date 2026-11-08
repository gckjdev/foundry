-- Realtime: include the changed column names so clients can ignore cosmetic updates
-- (e.g. `jobs` cost/token counters written on every runner event flush) and only re-render on
-- meaningful changes. INSERT/DELETE carry an empty list; clients treat those ops as always-refresh.
CREATE OR REPLACE FUNCTION foundry_notify_change() RETURNS trigger AS $$
DECLARE
  rec record;
  cols text[] := '{}';
BEGIN
  IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(k), '{}'::text[]) INTO cols
    FROM (
      SELECT k
      FROM jsonb_each(to_jsonb(NEW)) AS n(k, v)
      JOIN jsonb_each(to_jsonb(OLD)) AS o(k, v) USING (k)
      WHERE n.v IS DISTINCT FROM o.v
    ) d;
  END IF;

  PERFORM pg_notify(
    'foundry_changes',
    json_build_object('table', TG_TABLE_NAME, 'id', rec.id::text, 'team_id', rec.team_id::text, 'op', TG_OP, 'columns', cols)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
