"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastTone = "ok" | "warn" | "bad" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before the toast dismisses itself; 0 keeps it until dismissed. */
  duration?: number;
};

type ToastItem = ToastInput & { id: number };

type ToastApi = {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
};

const DEFAULT_DURATION = 5000;
const MAX_TOASTS = 3;

const ToastContext = createContext<ToastApi | null>(null);

/** Show a toast from anywhere inside the panel. Must be rendered under `<ToastProvider>`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

/**
 * Panel-wide toast viewport. Toasts stack bottom-right, announce politely to assistive tech, and
 * dismiss themselves after a few seconds without stealing focus from the form that raised them.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setItems((current) => [...current, { ...input, id }].slice(-MAX_TOASTS));
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Persistent live region so screen readers announce toasts inserted after page load. */}
      <ul className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </ul>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const duration = item.duration ?? DEFAULT_DURATION;

  // Hovering or focusing a toast holds it open so slow readers and keyboard users keep control.
  useEffect(() => {
    if (paused || duration <= 0) return;
    const timer = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, item.id, onDismiss]);

  return (
    <li
      className="toast"
      data-tone={item.tone ?? "info"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="toast-body">
        <div className="toast-title">{item.title}</div>
        {item.description ? <div className="toast-description">{item.description}</div> : null}
      </div>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(item.id)}
      >
        ×
      </button>
    </li>
  );
}
