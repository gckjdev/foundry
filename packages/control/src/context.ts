import type { Db } from "@foundry/db";
import type { GitHubClient } from "@foundry/github";
import { errorFields, type Logger } from "@foundry/shared";
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
