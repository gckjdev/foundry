import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { createDatabase, type Database, dialectOf, sqliteFilePath } from "./index";
import { migrate } from "./migrate";

/** Admin URL of a Postgres (or a `file:`/`sqlite:` URL) the tests may create databases on. Tests skip when unset. */
export const TEST_DATABASE_URL = process.env.FOUNDRY_TEST_DATABASE_URL ?? "";

/** Create a fresh, migrated database for one test file; drop it on cleanup. */
export async function createTestDatabase(): Promise<Database & { drop(): Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("FOUNDRY_TEST_DATABASE_URL is not set");
  if (dialectOf(TEST_DATABASE_URL) === "sqlite") return createSqliteTestDatabase();
  return createPostgresTestDatabase(TEST_DATABASE_URL);
}

/** A throwaway SQLite database (temp file unless `url` is given), migrated and dropped on cleanup. */
export async function createSqliteTestDatabase(url?: string): Promise<Database & { drop(): Promise<void> }> {
  const file = url ?? join(tmpdir(), `foundry_test_${randomBytes(6).toString("hex")}.sqlite`);
  const database = createDatabase(file, { max: 1 });
  await migrate(database);
  return {
    ...database,
    async drop() {
      await database.close();
      const path = sqliteFilePath(file);
      if (path === ":memory:") return;
      await Promise.all(
        ["", "-wal", "-shm", "-journal"].map((suffix) =>
          rm(`${path}${suffix}`, { force: true }).catch(() => {}),
        ),
      );
    },
  };
}

async function createPostgresTestDatabase(url: string): Promise<Database & { drop(): Promise<void> }> {
  const name = `foundry_test_${randomBytes(4).toString("hex")}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const adminUrl = new URL(url);
  adminUrl.pathname = `/${name}`;
  const database = createDatabase(adminUrl.toString(), { max: 5 });
  await migrate(database);
  return {
    ...database,
    async drop() {
      await database.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
