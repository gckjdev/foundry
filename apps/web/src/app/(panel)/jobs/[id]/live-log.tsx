"use client";

import type { FoundryEvent } from "@foundry/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type Line, mergeLines, needsServerRefresh } from "./live-log-lines";

function render(e: FoundryEvent): string {
  switch (e.kind) {
    case "tool_call":
      return `⚙ ${e.tool}${e.summary ? ` ${e.summary}` : ""}`;
    case "message":
      return `${e.role === "agent" ? "▸" : e.role === "human" ? "◂" : "·"} ${e.text}`;
    case "log":
      return `[${e.level}] ${e.message}`;
    case "usage":
      return `$ ${e.costUsd.toFixed(4)} (${e.tokensIn}→${e.tokensOut} tokens${e.model ? `, ${e.model}` : ""})`;
    case "subagent_started":
      return `↳ subagent ${e.name}`;
    case "stage_changed":
      return `── ${e.to.toUpperCase()} ──`;
    case "error":
      return `✖ ${e.message}`;
    default:
      return `${e.kind}`;
  }
}

/** Polls the incremental events endpoint every 2 s and appends new lines. */
export function LiveLog({ jobId, initial, after }: { jobId: string; initial: Line[]; after: number }) {
  const router = useRouter();
  const [lines, setLines] = useState(initial);
  const cursor = useRef(after);
  const box = useRef<HTMLDivElement>(null);
  const refresh = useRef(router.refresh);
  refresh.current = router.refresh;

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      while (!stop) {
        try {
          const res = await fetch(`/api/jobs/${jobId}/events?after=${cursor.current}`);
          if (res.ok) {
            const { events } = (await res.json()) as { events: Line[] };
            // This loop may have been stopped by the effect cleanup while the request was in flight.
            if (stop) return;
            if (events.length) {
              cursor.current = Math.max(cursor.current, events.at(-1)!.id);
              setLines((prev) => mergeLines(prev, events));
              // Rows this poll surfaced outside the log (evidence, timeline entries) only exist
              // in the server render, so ask for one now rather than on the next stage change.
              if (needsServerRefresh(events)) refresh.current();
            }
          }
        } catch {
          if (stop) return;
          // keep polling
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [jobId]);

  useEffect(() => {
    const el = box.current;
    if (!el || lines.length === 0) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="log" ref={box}>
      {lines.length === 0 ? <span className="faint">No activity yet.</span> : null}
      {lines.map((l) => (
        <div key={l.id}>
          <span className="faint">{new Date(l.ts).toLocaleTimeString()} </span>
          {render(l.payload)}
        </div>
      ))}
    </div>
  );
}
