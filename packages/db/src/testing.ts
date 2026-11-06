import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDatabase, type Database } from "./index";
import { migrate } from "./migrate";

/** Admin URL of a Postgres the tests may create databases on. Tests skip when unset. */
export const TEST_DATABASE_URL = process.env.FOUNDRY_TEST_DATABASE_URL ?? "";

/** Create a fresh, migrated database for one test file; drop it on cleanup. */
export async function createTestDatabase(): Promise<Database & { drop(): Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("FOUNDRY_TEST_DATABASE_URL is not set");
  const name = `foundry_test_${randomBytes(4).toString("hex")}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString(), { max: 5 });
  await migrate(database.sql);
  return {
    ...database,
    async drop() {
      await database.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
