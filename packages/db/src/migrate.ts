import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./index";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const SQLITE_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations-sqlite");

/** Apply the dialect's `migrations[/*.sql` in order, each file in its own transaction. Idempotent. */
export async function migrate(database: Database, dir?: string): Promise<string[]> {
  return database.dialect === "sqlite"
    ? migrateSqlite(database, dir ?? SQLITE_MIGRATIONS_DIR)
    : migratePostgres(database, dir ?? MIGRATIONS_DIR);
}

async function migratePostgres(database: Database, dir: string): Promise<string[]> {
  const sql = database.sql!;
  await sql`create table if not exists _foundry_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set(
    (await sql<{ name: string }[]>`select name from _foundry_migrations`).map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(join(dir, file), "utf8");
    const statements = text
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await sql.begin(async (tx) => {
      for (const stmt of statements) await tx.unsafe(stmt);
      await tx`insert into _foundry_migrations (name) values (${file})`;
    });
    applied.push(file);
  }
  return applied;
}

async function migrateSqlite(database: Database, dir: string): Promise<string[]> {
  const sqlite = database.sqlite!;
  await sqlite.execute(
    "create table if not exists _foundry_migrations (name text primary key, applied_at integer not null default (unixepoch() * 1000))",
  );
  const done = new Set(
    (await sqlite.execute("select name from _foundry_migrations")).rows.map((r) => String(r.name)),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(join(dir, file), "utf8");
    const statements = text
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    const tx = await sqlite.transaction("write");
    try {
      for (const stmt of statements) await tx.execute(stmt);
      await tx.execute({ sql: "insert into _foundry_migrations (name) values (?)", args: [file] });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      tx.close();
    }
    applied.push(file);
  }
  return applied;
}
