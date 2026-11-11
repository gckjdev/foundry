"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isRefreshMessage, tablesForPage } from "./realtime-tables";

/**
 * Subscribes to the realtime service and re-renders the current server page when a table it
 * actually renders changes. Re-renders are debounced so a burst of agent events costs one refresh.
 */
export function LiveRefresh({ tables }: { tables?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useRef(router.refresh);
  refresh.current = router.refresh;
  const tablesKey = (tables ?? tablesForPage(pathname)).join(",");
  const watched = useRef(new Set(tablesKey ? tablesKey.split(",") : []));

  // Navigating between panel pages keeps the WebSocket open; only the filter changes.
  useEffect(() => {
    watched.current = new Set(tablesKey ? tablesKey.split(",") : []);
  }, [tablesKey]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;

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
          const msg = JSON.parse(String(ev.data)) as {
            type?: string;
            table?: string;
            op?: string;
            columns?: string[];
          };
          if (!isRefreshMessage(watched.current, msg)) return;
          if (timer.current) return;
          timer.current = setTimeout(() => {
            timer.current = null;
            refresh.current();
          }, 400);
        };
        ws.onclose = () => {
          setState("offline");
          backoff = Math.min(backoff * 2, 30_000);
          if (!closed) setTimeout(connect, backoff);
        };
      } catch {
        setState("offline");
        backoff = Math.min(backoff * 2, 30_000);
        if (!closed) setTimeout(connect, backoff);
      }
    };
    void connect();
    return () => {
      closed = true;
      ws?.close();
    };
    // Connect once for the layout's lifetime; pathname only updates `watched` above.
  }, []);

  return (
    <span
      className="pill"
      data-tone={state === "live" ? "live" : state === "offline" ? "bad" : ""}
      title="Realtime"
    >
      {state === "live" ? "live" : state}
    </span>
  );
}
