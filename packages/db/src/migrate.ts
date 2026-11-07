import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Apply `migrations/*.sql` in order, each in its own transaction. Idempotent. */
export async function migrate(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
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
