import { loadEnvFile } from "node:process";
import postgres from "postgres";
import { migrate } from "./migrate";

// Local dev: load the repo-root `.env` (DATABASE_URL etc.) when it exists. Deployments
// (e.g. the compose `migrate` service) inject DATABASE_URL directly and ship no `.env`,
// so a missing file must not fail startup.
try {
  loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // no `.env` at the repo root — rely on the ambient environment
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const applied = await migrate(sql);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date");
await sql.end();
