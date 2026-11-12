import type { Db } from "@foundry/db";
import type { GitHubClient } from "@foundry/github";
import { errorFields, type LogFields, type Logger } from "@foundry/shared";
import type { Sql } from "postgres";
import type { Notifier } from "./notify";

export interface ControlContext {
  db: Db;
  sql: Sql;
  gh: GitHubClient;
  notifier: Notifier;
  /** Public base URL of the panel, used in links posted to GitHub. */
  publicUrl: string;
  /** WebSocket URL handed to runners and browsers. */
  realtimeUrl: string;
  /** HMAC secret for realtime, join and artifact tokens. */
  secret: string;
  now: () => Date;
  /** Structured process logger (see docs/logging.md). */
  log: Logger;
}

export function jobUrl(ctx: ControlContext, jobId: string): string {
  return `${ctx.publicUrl.replace(/\/$/, "")}/jobs/${jobId}`;
}

/**
 * A view of the context whose logger is bound to extra fields, typically a `correlationId`, so
 * every record of one execution shares it. `Object.create` keeps lazy getters (such as `gh`) lazy.
 */
export function withLogFields(ctx: ControlContext, fields: LogFields): ControlContext {
  const scoped = Object.create(ctx) as ControlContext;
  Object.defineProperty(scoped, "log", {
    value: ctx.log.child(fields),
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return scoped;
}

/** Run a side effect (GitHub, notifications) without letting its failure break the caller. */
export async function bestEffort(
  ctx: ControlContext,
  what: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    ctx.log.warn(`${what} failed`, errorFields(err));
  }
}
