import { migrate } from "../src/lib/db";

migrate()
  .then(() => console.log("Schema is up to date."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
