import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);

// A real hash of a random string, used so "unknown email" takes as long as "wrong password".
export const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), BCRYPT_COST);

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export async function authenticate(pool, email, password) {
  const [rows] = await pool.query("SELECT * FROM admins WHERE email = ? LIMIT 1", [email]);
  const admin = rows[0];
  const ok = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  return ok && admin?.active ? admin : null;
}

/** Creates a session and returns the opaque token (only its hash is stored). */
export async function createSession(pool, adminId, { ip, userAgent, ttlHours }) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO admin_sessions (admin_id, token_hash, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
    [adminId, sha256(token), ip?.slice(0, 64) ?? null, userAgent?.slice(0, 255) ?? null, Math.round(ttlHours * 3600)]
  );
  await pool.query("UPDATE admins SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [adminId]);
  // Opportunistic cleanup so the table doesn't grow forever.
  pool.query("DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP()").catch(() => {});
  return token;
}

/** The active admin owning a live session token, or null. */
export async function findSession(pool, token) {
  const [rows] = await pool.query(
    `SELECT a.id, a.email, a.name, s.token_hash
     FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND a.active = 1
     LIMIT 1`,
    [sha256(token)]
  );
  return rows[0] ?? null;
}

export const destroySession = (pool, token) =>
  pool.query("DELETE FROM admin_sessions WHERE token_hash = ?", [sha256(token)]);

/** After a password change: sign out every other device/session. */
export const destroyOtherSessions = (pool, adminId, keepToken) =>
  pool.query("DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?", [adminId, sha256(keepToken)]);
