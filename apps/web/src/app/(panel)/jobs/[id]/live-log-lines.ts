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
