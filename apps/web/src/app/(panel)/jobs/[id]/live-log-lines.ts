import type { FoundryEvent } from "@foundry/shared";

export interface Line {
  id: number;
  ts: string;
  payload: FoundryEvent;
}

const MAX_LINES = 1000;

/**
 * Appends freshly polled events, dropping ids that are already rendered.
 *
 * React Strict Mode invokes effects twice in development, so the first poll loop can still
 * resolve after cleanup; the cursor alone does not prevent two loops from appending the same
 * batch and producing duplicate React keys.
 */
export function mergeLines(prev: Line[], incoming: Line[]): Line[] {
  const seen = new Set(prev.map((l) => l.id));
  const fresh = incoming.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
  return fresh.length === 0 ? prev : [...prev, ...fresh].slice(-MAX_LINES);
}

/** Kinds the live log draws itself; every other kind also changes server-rendered page content. */
const LOG_ONLY_KINDS: ReadonlySet<FoundryEvent["kind"]> = new Set([
  "tool_call",
  "usage",
  "log",
  "subagent_started",
]);

/**
 * Whether freshly polled events require a server re-render of the job page.
 *
 * The page used to follow `events` over realtime, but that channel fans out one row per tool call
 * for every job on the team. This poll is scoped to the current job, so only the kinds the page
 * renders outside the live log — the Evidence card (`evidence`) and Timeline entries (stage
 * changes, gate results, errors, human messages, …) — are worth re-rendering for. Agent messages
 * arrive every assistant turn and the Timeline does not render them, so they stay log-only.
 */
export function needsServerRefresh(events: readonly Line[]): boolean {
  return events.some((e) =>
    e.payload.kind === "message" ? e.payload.role === "human" : !LOG_ONLY_KINDS.has(e.payload.kind),
  );
}
