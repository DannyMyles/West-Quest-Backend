import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { conflict } from "../errors.js";
import { DUMMY_HASH, hashPassword, sha256 } from "./auth.js";
import { phoneKey } from "./applications.js";

const serialize = (row) => ({ id: row.id, name: row.name, phone: row.phone, location: row.location });

/** Creates an account. The phone number (last 9 digits) is the identity. */
export async function registerCustomer(pool, { name, phone, password }) {
  try {
    const [result] = await pool.query("INSERT INTO customers (name, phone, phone_key, password_hash) VALUES (?, ?, ?, ?)", [
      name,
      phone,
      phoneKey(phone),
      await hashPassword(password),
    ]);
    return { id: result.insertId, name, phone, location: null };
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      throw conflict("An account with this phone number already exists — sign in instead", [{ path: "phone", message: "Already registered" }], "PHONE_TAKEN");
    }
    throw err;
  }
}

export async function authenticateCustomer(pool, phone, password) {
  const [rows] = await pool.query("SELECT * FROM customers WHERE phone_key = ? LIMIT 1", [phoneKey(phone)]);
  const customer = rows[0];
  const ok = await bcrypt.compare(password, customer?.password_hash ?? DUMMY_HASH);
  return ok && customer?.active ? serialize(customer) : null;
}

/** Creates a session and returns the opaque token (only its hash is stored). */
export async function createCustomerSession(pool, customerId, { ip, userAgent, ttlHours }) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO customer_sessions (customer_id, token_hash, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
    [customerId, sha256(token), ip?.slice(0, 64) ?? null, userAgent?.slice(0, 255) ?? null, Math.round(ttlHours * 3600)]
  );
  await pool.query("UPDATE customers SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [customerId]);
  pool.query("DELETE FROM customer_sessions WHERE expires_at < UTC_TIMESTAMP()").catch(() => {});
  return token;
}

export async function findCustomerSession(pool, token) {
  const [rows] = await pool.query(
    `SELECT c.* FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND c.active = 1 LIMIT 1`,
    [sha256(token)]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

export const destroyCustomerSession = (pool, token) => pool.query("DELETE FROM customer_sessions WHERE token_hash = ?", [sha256(token)]);
