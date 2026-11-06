import type { Recipe } from "@foundry/shared";
import postgres from "postgres";

export function jobDatabaseName(jobId: string, name: string): string {
  return `foundry_${jobId.replace(/-/g, "").slice(0, 12)}_${name.replace(/\W+/g, "_")}`.toLowerCase().slice(0, 63);
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * Per-job services from `recipe.services` (spec 5.9): a fresh database on the runner's own
 * Postgres (`FOUNDRY_POSTGRES_URL`), exposed to the job as `DATABASE_URL`.
 */
export async function provisionServices(
  jobId: string,
  recipe: Recipe | null,
  adminUrl: string | undefined,
): Promise<Record<string, string>> {
  const pg = recipe?.services.postgres;
  if (!pg) return {};
  if (!adminUrl) throw new Error("the recipe needs Postgres but FOUNDRY_POSTGRES_URL is not set on this runner");
  const name = jobDatabaseName(jobId, pg.database);
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const exists = await sql`select 1 from pg_database where datname = ${name}`;
    if (exists.length === 0) await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end();
  }
  const url = withDatabase(adminUrl, name);
  return { DATABASE_URL: url, FOUNDRY_DATABASE_URL: url };
}

export async function dropServices(jobId: string, recipe: Recipe | null, adminUrl: string | undefined): Promise<void> {
  const pg = recipe?.services.postgres;
  if (!pg || !adminUrl) return;
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`drop database if exists "${jobDatabaseName(jobId, pg.database)}" with (force)`);
  } finally {
    await sql.end();
  }
}
