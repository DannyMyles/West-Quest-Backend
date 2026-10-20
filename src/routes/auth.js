import { Router } from "express";
import { HttpError, parse } from "../errors.js";
import { changePasswordSchema, loginSchema } from "../schemas.js";
import {
  authenticate,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashPassword,
} from "../services/auth.js";
import bcrypt from "bcryptjs";
import { cookieOptions, requireAdmin } from "../middleware/auth.js";
import { loginLimiter } from "../middleware/security.js";

export function authRouter(ctx, { loginAttempts = 10 } = {}) {
  const { pool, config } = ctx;
  const r = Router();
  const cookieName = config.session.cookieName;

  r.post("/login", loginLimiter(loginAttempts), async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const admin = await authenticate(pool, email, password);
    if (!admin) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");

    const token = await createSession(pool, admin.id, {
      ip: req.ip,
      userAgent: req.get("user-agent"),
      ttlHours: config.session.ttlHours,
    });
    res.cookie(cookieName, token, cookieOptions(config));
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  });

  // Idempotent: works (and clears the cookie) even if the session already expired.
  r.post("/logout", async (req, res) => {
    const token = req.cookies?.[cookieName];
    if (token) await destroySession(pool, token);
    res.clearCookie(cookieName, cookieOptions(config, { withMaxAge: false }));
    res.status(204).end();
  });

  r.get("/me", requireAdmin(ctx), (req, res) => {
    res.json({ admin: req.admin });
  });

  r.post("/change-password", requireAdmin(ctx), async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const [rows] = await pool.query("SELECT password_hash FROM admins WHERE id = ?", [req.admin.id]);
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
    }
    if (currentPassword === newPassword) {
      throw new HttpError(422, "VALIDATION_ERROR", "New password must be different", [
        { path: "newPassword", message: "Must differ from the current password" },
      ]);
    }
    await pool.query("UPDATE admins SET password_hash = ? WHERE id = ?", [await hashPassword(newPassword), req.admin.id]);
    await destroyOtherSessions(pool, req.admin.id, req.sessionToken);
    res.status(204).end();
  });

  return r;
}
