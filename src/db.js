import mysql from "mysql2/promise";

export function createPool(dbConfig) {
  return mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    charset: "utf8mb4",
    timezone: "Z",
    waitForConnections: true,
    connectionLimit: dbConfig.poolSize ?? 10,
    // Read LIMIT/OFFSET etc. as plain numbers, DECIMAL as numbers, no surprises.
    decimalNumbers: true,
  });
}

/** Run `fn(conn)` inside a transaction; commits on success, rolls back on throw. */
export async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
