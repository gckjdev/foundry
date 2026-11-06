import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Db = PostgresJsDatabase<typeof schema>;

export interface Database {
  db: Db;
  sql: Sql;
  close(): Promise<void>;
}

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
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
