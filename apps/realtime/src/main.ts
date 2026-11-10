import { createLogger } from "@foundry/shared";
import postgres from "postgres";
import { startRealtime } from "./server";

const log = createLogger({ service: "realtime" });
const url = process.env.DATABASE_URL;
const secret = process.env.FOUNDRY_SECRET;
if (!url || !secret) {
  log.error("DATABASE_URL and FOUNDRY_SECRET must be set");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3001);
const sql = postgres(url, { max: 2, onnotice: () => {} });
const rt = await startRealtime({ sql, secret, port });
log.info("realtime listening", { port });

const shutdown = async () => {
  log.info("realtime shutting down");
  await rt.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
