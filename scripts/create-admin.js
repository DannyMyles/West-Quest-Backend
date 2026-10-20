// Creates (or resets the password of) an admin user.
//   npm run create-admin -- --email you@example.com --name "Your Name" [--password '...']
// Without --password a strong random one is generated and printed once.
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { hashPassword } from "../src/services/auth.js";
import { loginSchema, newPasswordSchema } from "../src/schemas.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
    reset: { type: "boolean", default: false },
  },
});

if (!values.email) {
  console.error('Usage: npm run create-admin -- --email you@example.com --name "Your Name" [--password ...] [--reset]');
  process.exit(1);
}

const email = loginSchema.shape.email.safeParse(values.email);
if (!email.success) {
  console.error(`Invalid email: ${values.email}`);
  process.exit(1);
}
const generated = !values.password;
const password = values.password ?? crypto.randomBytes(12).toString("base64url");
const pw = newPasswordSchema.safeParse(password);
if (!pw.success) {
  console.error(pw.error.issues[0].message);
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.db);
try {
  const hash = await hashPassword(password);
  const [existing] = await pool.query("SELECT id FROM admins WHERE email = ?", [email.data]);
  if (existing.length && !values.reset) {
    console.error(`An admin with ${email.data} already exists. Pass --reset to set a new password.`);
    process.exitCode = 1;
  } else if (existing.length) {
    await pool.query("UPDATE admins SET password_hash = ?, active = 1 WHERE id = ?", [hash, existing[0].id]);
    await pool.query("DELETE FROM admin_sessions WHERE admin_id = ?", [existing[0].id]);
    console.log(`Password reset for ${email.data} (all existing sessions revoked).`);
  } else {
    await pool.query("INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)", [
      email.data,
      values.name ?? email.data.split("@")[0],
      hash,
    ]);
    console.log(`Admin created: ${email.data}`);
  }
  if (generated && !process.exitCode) console.log(`Generated password (shown once): ${password}`);
} finally {
  await pool.end();
}
