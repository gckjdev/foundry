import { createDatabase } from "@foundry/db";
import { startRealtime } from "./server";

const url = process.env.DATABASE_URL;
const secret = process.env.FOUNDRY_SECRET;
if (!url || !secret) {
  console.error("DATABASE_URL and FOUNDRY_SECRET must be set");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3001);
const database = createDatabase(url, { max: 2 });
const rt = await startRealtime({ sql: database.sql, sqlite: database.sqlite, secret, port });
console.log(`foundry realtime listening on :${port}`);

const shutdown = async () => {
  await rt.close();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
