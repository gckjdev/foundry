/**
 * Which Postgres tables each panel page actually renders. A realtime change must only re-render a
 * page when the table it touches can change what that page shows: `events` gets a row per agent
 * tool call (the runner flushes them every second) and `runners` a row per heartbeat, so a page
 * that does not display them must not refresh on them. The nav's connection pill stays live
 * either way — an empty set only suppresses refreshes.
 */
const PAGE_TABLES: readonly { prefix: string; tables: readonly string[] }[] = [
  { prefix: "/board", tables: ["jobs"] },
  { prefix: "/inbox", tables: ["jobs", "questions"] },
  { prefix: "/jobs/", tables: ["jobs", "questions", "events"] },
  { prefix: "/runners", tables: ["runners", "jobs"] },
  { prefix: "/repos", tables: ["jobs"] },
  { prefix: "/metrics", tables: ["jobs"] },
];

/** Tables whose changes should re-render `pathname`; none for pages without live data. */
export function tablesForPage(pathname: string | null | undefined): string[] {
  const page = PAGE_TABLES.find((p) => pathname?.startsWith(p.prefix));
  return page ? [...page.tables] : [];
}

/** Whether a realtime message should trigger a refresh for a page watching `tables`. */
export function isRefreshMessage(
  tables: ReadonlySet<string>,
  msg: { type?: string; table?: string },
): boolean {
  return msg.type === "change" && typeof msg.table === "string" && tables.has(msg.table);
}
