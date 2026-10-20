import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

/**
 * Applies every db/migrations/NNN_*.sql that hasn't run yet, in order, and
 * records it in `schema_migrations`. `conn` must allow multiple statements.
 * Migrations are written idempotently (IF NOT EXISTS), so a database created
 * before this table existed is adopted safely.
 * @returns {Promise<string[]>} the names applied this run
 */
export async function runMigrations(conn, dir = MIGRATIONS_DIR) {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(120) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [done] = await conn.query("SELECT name FROM schema_migrations");
  const applied = new Set(done.map((r) => r.name));

  const files = (await fs.readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    await conn.query(await fs.readFile(path.join(dir, file), "utf8"));
    await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
    ran.push(file);
  }
  return ran;
}
