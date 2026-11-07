"use client";

import { useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Registers the service worker and a Web Push subscription for this browser. */
export function PushToggle() {
  const [state, setState] = useState<string>("");
  const enable = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        return setState("Push is not supported here.");
      const { publicKey } = (await (await fetch("/api/push/subscribe")).json()) as {
        publicKey: string | null;
      };
      if (!publicKey) return setState("The server has no VAPID keys configured.");
      if ((await Notification.requestPermission()) !== "granted") return setState("Permission denied.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });
      setState("Push enabled for this browser.");
    } catch (err) {
      setState(`Could not enable push: ${String(err)}`);
    }
  };
  return (
    <div className="row">
      <button type="button" onClick={enable}>
        Enable push on this device
      </button>
      <span className="faint small">{state}</span>
    </div>
  );
}
