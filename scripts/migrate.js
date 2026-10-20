// Applies db/migrations/*.sql (idempotent). Creates the database if it doesn't exist
// and the configured user has permission to.
import mysql from "mysql2/promise";
import { loadConfig } from "../src/config.js";
import { runMigrations } from "../src/migrate.js";

const config = loadConfig();
const { host, port, user, password, database } = config.db;

if (!/^[A-Za-z0-9_]+$/.test(database)) {
  console.error(`Refusing database name "${database}" — use letters, digits and underscores only.`);
  process.exit(1);
}

const conn = await mysql.createConnection({ host, port, user, password, multipleStatements: true, charset: "utf8mb4" });
try {
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${database}\``);
  const ran = await runMigrations(conn);
  console.log(
    ran.length
      ? `"${database}" @ ${host}:${port}: applied ${ran.join(", ")}`
      : `"${database}" @ ${host}:${port}: already up to date`
  );
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await conn.end();
}
