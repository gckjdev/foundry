import { createDatabase } from "./index";
import { migrate } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const database = createDatabase(url, { max: 1 });
const applied = await migrate(database);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date");
await database.close();
