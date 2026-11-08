import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient, type Client as LibSqlClient } from "@libsql/client";
import { drizzle as drizzleSqlite } from "drizzle-orm/libsql";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";
import * as sqliteSchema from "./schema.sqlite";

export type { EventRow, Evidence, Job, Question, Repo, Runner, Team, User } from "./schema";

export type Dialect = "postgres" | "sqlite";
export type SqliteClient = LibSqlClient;
export type Db = PostgresJsDatabase<typeof schema>;

export interface Database {
  db: Db;
  /** Postgres connection; null when the active dialect is sqlite. */
  sql: Sql | null;
  /** libsql client; null when the active dialect is postgres. */
  sqlite: SqliteClient | null;
  dialect: Dialect;
  close(): Promise<void>;
}

/** `postgres://` / `postgresql://` are Postgres; everything else (`file:`, `sqlite:`, `.sqlite`) is SQLite. */
export function dialectOf(url: string): Dialect {
  return url.startsWith("postgres://") || url.startsWith("postgresql://") ? "postgres" : "sqlite";
}

// Repo root, so a relative `file:./data/...` URL resolves to the same file regardless of which
// package's directory the process was started from (web, realtime, or the migrate CLI).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Resolve a `file:`/`sqlite:` URL (or bare path) to a filesystem path; `:memory:` passes through. */
export function sqliteFilePath(url: string): string {
  if (url === ":memory:" || url === "sqlite::memory:" || url === "file::memory:") return ":memory:";
  let raw = url;
  if (raw.startsWith("sqlite:")) raw = raw.slice("sqlite:".length);
  else if (raw.startsWith("file:")) raw = raw.slice("file:".length);
  if (url.startsWith("file://")) return fileURLToPath(url);
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
}

// The active schema namespace. Table exports below are proxies over whichever schema
// `createDatabase` last activated, so `@foundry/control` keeps importing `jobs`, `teams`, …
// unchanged while the same column names resolve against either dialect.
let activeSchema: typeof schema | typeof sqliteSchema = schema;

const TABLES = [
  "teams",
  "users",
  "memberships",
  "invites",
  "repos",
  "runners",
  "runnerRepoReadiness",
  "jobs",
  "events",
  "questions",
  "jobInputs",
  "evidence",
  "artifacts",
  "webhookInbox",
  "notifications",
] as const;

type TableName = (typeof TABLES)[number];

function tableProxy<T extends object>(name: TableName): T {
  const handler: ProxyHandler<T> = {
    get(_target, prop: string | symbol) {
      const table = (activeSchema as unknown as Record<TableName, Record<string, unknown>>)[name];
      const value = table[prop as string];
      return typeof value === "function" ? value.bind(table) : value;
    },
    // Make `instanceof`/drizzle's `is(…, Table)` succeed against the active schema's table class,
    // otherwise drizzle renders the table as a parenthesized subquery instead of its name.
    getPrototypeOf() {
      return Object.getPrototypeOf(
        (activeSchema as unknown as Record<TableName, Record<string, unknown>>)[name],
      );
    },
    has(_target, prop) {
      return prop in (activeSchema as unknown as Record<TableName, Record<string, unknown>>)[name];
    },
    ownKeys() {
      return Reflect.ownKeys((activeSchema as unknown as Record<TableName, Record<string, unknown>>)[name]);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Object.getOwnPropertyDescriptor(
        (activeSchema as unknown as Record<TableName, Record<string, unknown>>)[name],
        prop,
      );
    },
  };
  return new Proxy({} as T, handler);
}

export const teams = tableProxy<typeof schema.teams>("teams");
export const users = tableProxy<typeof schema.users>("users");
export const memberships = tableProxy<typeof schema.memberships>("memberships");
export const invites = tableProxy<typeof schema.invites>("invites");
export const repos = tableProxy<typeof schema.repos>("repos");
export const runners = tableProxy<typeof schema.runners>("runners");
export const runnerRepoReadiness = tableProxy<typeof schema.runnerRepoReadiness>("runnerRepoReadiness");
export const jobs = tableProxy<typeof schema.jobs>("jobs");
export const events = tableProxy<typeof schema.events>("events");
export const questions = tableProxy<typeof schema.questions>("questions");
export const jobInputs = tableProxy<typeof schema.jobInputs>("jobInputs");
export const evidence = tableProxy<typeof schema.evidence>("evidence");
export const artifacts = tableProxy<typeof schema.artifacts>("artifacts");
export const webhookInbox = tableProxy<typeof schema.webhookInbox>("webhookInbox");
export const notifications = tableProxy<typeof schema.notifications>("notifications");

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const dialect = dialectOf(url);
  if (dialect === "postgres") {
    const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
    const db = drizzlePg(sql, { schema });
    activeSchema = schema;
    return { db, sql, sqlite: null, dialect, close: () => sql.end() };
  }

  const filePath = sqliteFilePath(url);
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = createClient({ url: filePath === ":memory:" ? ":memory:" : pathToFileURL(filePath).href });
  // WAL lets the web + realtime processes read/write one file concurrently; FK enforcement is
  // per-connection and off by default in SQLite.
  void sqlite.execute("PRAGMA journal_mode = WAL").catch(() => {});
  void sqlite.execute("PRAGMA foreign_keys = ON").catch(() => {});
  const db = drizzleSqlite(sqlite, { schema: sqliteSchema }) as unknown as Db;
  activeSchema = sqliteSchema;
  return {
    db,
    sql: null,
    sqlite,
    dialect,
    close: async () => {
      sqlite.close();
    },
  };
}

const globalForDb = globalThis as unknown as { __foundryDb?: Database };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDatabase(): Database {
  if (!globalForDb.__foundryDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__foundryDb = createDatabase(url);
  }
  return globalForDb.__foundryDb;
}
