import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config.db);

// Fail fast if the database isn't reachable / migrated.
try {
  await pool.query("SELECT 1 FROM admin_sessions LIMIT 1");
} catch (err) {
  console.error(`Cannot use database "${config.db.database}" at ${config.db.host}:${config.db.port}: ${err.message}`);
  console.error("Have you run `npm run migrate`?");
  process.exit(1);
}

const app = createApp({ config, pool });
const server = app.listen(config.port, config.host, () => {
  console.log(`West Quest backend listening on http://${config.host}:${config.port} (${config.env})`);
});

async function shutdown(signal) {
  console.log(`${signal} received — shutting down`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
