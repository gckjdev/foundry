import "server-only";
import {
  ChannelNotifier,
  type ControlContext,
  defaultTransports,
  startWorker,
  type Transports,
} from "@foundry/control";
import { getDatabase } from "@foundry/db";
import { getGitHub } from "@foundry/github";

const g = globalThis as unknown as {
  __foundryCtx?: Promise<{ ctx: ControlContext; transports: Transports }>;
  __foundryWorker?: () => void;
  __foundryTestCtx?: ControlContext;
};

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is not set`);
  return v;
}

async function build() {
  const { db, sql, sqlite, dialect } = getDatabase();
  const transports = await defaultTransports();
  const publicUrl = env("FOUNDRY_PUBLIC_URL", "http://localhost:3000");
  const ctx: ControlContext = {
    db,
    sql,
    sqlite,
    dialect,
    get gh() {
      return getGitHub();
    },
    notifier: new ChannelNotifier(transports),
    publicUrl,
    realtimeUrl: env("FOUNDRY_REALTIME_URL", `${publicUrl.replace(/^http/, "ws")}/realtime`),
    secret: env("FOUNDRY_SECRET"),
    now: () => new Date(),
    log: (message, extra) => console.log(JSON.stringify({ level: "info", message, ...extra })),
  };
  return { ctx, transports };
}

export async function getContext(): Promise<ControlContext> {
  if (g.__foundryTestCtx) return g.__foundryTestCtx;
  g.__foundryCtx ??= build();
  return (await g.__foundryCtx).ctx;
}

/** Swap the control plane for in-process API tests. Pass `undefined` to restore. */
export function setContextForTests(ctx: ControlContext | undefined): void {
  g.__foundryTestCtx = ctx;
}

/** Started once per server process from instrumentation.ts. */
export async function ensureWorker(): Promise<void> {
  if (g.__foundryWorker) return;
  g.__foundryCtx ??= build();
  const { ctx, transports } = await g.__foundryCtx;
  g.__foundryWorker = startWorker(ctx, transports);
}
