"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Subscribes to the realtime service and re-renders the current server page when any row for
 * this team changes. Re-renders are debounced so a burst of agent events costs one refresh.
 */
export function LiveRefresh({ tables }: { tables?: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filter = tables?.join(",");

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;
    const wanted = filter ? new Set(filter.split(",")) : null;

    const connect = async () => {
      try {
        const res = await fetch("/api/realtime-token");
        if (!res.ok) throw new Error("token");
        const { url, token } = (await res.json()) as { url: string; token: string };
        ws = new WebSocket(url, ["foundry", token]);
        ws.onopen = () => {
          backoff = 1000;
          setState("live");
        };
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as { type: string; table?: string };
          if (msg.type !== "change" || (wanted && msg.table && !wanted.has(msg.table))) return;
          if (timer.current) return;
          timer.current = setTimeout(() => {
            timer.current = null;
            router.refresh();
          }, 400);
        };
        ws.onclose = () => {
          setState("offline");
          if (!closed) setTimeout(connect, (backoff = Math.min(backoff * 2, 30_000)));
        };
      } catch {
        setState("offline");
        if (!closed) setTimeout(connect, (backoff = Math.min(backoff * 2, 30_000)));
      }
    };
    void connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [router, filter]);

  return (
    <span className="pill" data-tone={state === "live" ? "live" : state === "offline" ? "bad" : ""} title="Realtime">
      {state === "live" ? "live" : state}
    </span>
  );
}
