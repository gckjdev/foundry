/**
 * Which Postgres tables each panel page actually renders. A realtime change must only re-render a
 * page when the table it touches can change what that page shows: `events` gets a row per agent
 * tool call (the runner flushes them every second) and `runners` a row per heartbeat, so a page
 * that does not display them must not refresh on them. The nav's connection pill stays live
 * either way — an empty set only suppresses refreshes.
 *
 * No page follows `events` over realtime. The job page's live log polls
 * `/api/jobs/:id/events` itself, and the broadcast is team-wide and fires per tool call, so
 * subscribing would re-render the whole page — and re-sign every artifact URL — every second
 * while any job runs, including a job the page is not showing. `jobs` and `questions` cover the
 * server-rendered parts that actually change (status, plan, gate, timeline stage moves).
 */
const PAGE_TABLES: readonly { prefix: string; tables: readonly string[] }[] = [
  { prefix: "/board", tables: ["jobs"] },
  { prefix: "/inbox", tables: ["jobs", "questions"] },
  { prefix: "/jobs/", tables: ["jobs", "questions"] },
  { prefix: "/runners", tables: ["runners", "jobs"] },
  { prefix: "/repos", tables: ["jobs"] },
  { prefix: "/metrics", tables: ["jobs"] },
];

/** Tables whose changes should re-render `pathname`; none for pages without live data. */
export function tablesForPage(pathname: string | null | undefined): string[] {
  const page = PAGE_TABLES.find((p) => pathname?.startsWith(p.prefix));
  return page ? [...page.tables] : [];
}

/**
 * Columns whose updates are cosmetic for the UI and must not trigger a re-render. The runner
 * writes `costUsd`/`tokensIn`/`tokensOut` back to `jobs` on every event flush (about once a
 * second) and the `jobs_touch` trigger bumps `updated_at` alongside, so a `jobs` change whose
 * only differing columns are these is just an accounting tick, not a status move.
 *
 * `questions.gh_comment_id` is set right after a question is inserted; the panel never renders it,
 * so the INSERT already covers the refresh. `helpful` is not noise: the job page shows it.
 *
 * A runner heartbeat rewrites `last_seen_at` (and often cpu/mem/disk) every 15 s. The runners page
 * only needs a refresh when the runner's *state* changes (accepting, draining, removed), not on
 * those telemetry ticks — `isOnline` already has a 2-minute grace window.
 */
const NOISE_COLUMNS: Record<string, ReadonlySet<string>> = {
  jobs: new Set(["cost_usd", "tokens_in", "tokens_out", "updated_at"]),
  questions: new Set(["gh_comment_id"]),
  runners: new Set(["last_seen_at", "cpu", "mem_mb", "disk_free_mb", "on_ac_power", "harnesses", "version"]),
};

/** Whether a realtime message should trigger a refresh for a page watching `tables`. */
export function isRefreshMessage(
  tables: ReadonlySet<string>,
  msg: { type?: string; table?: string; op?: string; columns?: string[] },
): boolean {
  if (msg.type !== "change" || typeof msg.table !== "string") return false;
  if (!tables.has(msg.table)) return false;
  if (msg.op === "INSERT" || msg.op === "DELETE") return true;
  // Older payloads carry no column info (the realtime service also normalizes a missing list to
  // `[]`); keep refreshing to avoid dropping a real change.
  if (!Array.isArray(msg.columns) || msg.columns.length === 0) return true;
  const noise = NOISE_COLUMNS[msg.table];
  if (!noise) return true;
  return msg.columns.some((c) => !noise.has(c));
}
