import { Router } from "express";
import { HttpError, conflict, notFound, parse, rethrowDuplicate } from "../errors.js";
import { adminCreateSchema, adminUpdateSchema, idParam } from "../schemas.js";
import { hashPassword } from "../services/auth.js";

const serialize = (r) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  active: Boolean(r.active),
  lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Manage who can sign in to the admin. Any signed-in admin can (this is a small-shop tool). */
export function adminUsersRouter({ pool }) {
  const r = Router();

  const activeCount = async () => (await pool.query("SELECT COUNT(*) AS n FROM admins WHERE active = 1"))[0][0].n;

  r.get("/admins", async (_req, res) => {
    const [rows] = await pool.query("SELECT id, email, name, active, last_login_at, created_at FROM admins ORDER BY id");
    res.json({ items: rows.map(serialize) });
  });

  r.post("/admins", async (req, res) => {
    const input = parse(adminCreateSchema, req.body);
    try {
      const [result] = await pool.query("INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)", [
        input.email,
        input.name,
        await hashPassword(input.password),
      ]);
      const [rows] = await pool.query("SELECT id, email, name, active, last_login_at, created_at FROM admins WHERE id = ?", [result.insertId]);
      res.status(201).json(serialize(rows[0]));
    } catch (err) {
      rethrowDuplicate(err);
    }
  });

  // Deactivate/reactivate, rename, or set a new password (which also signs that admin out everywhere).
  r.patch("/admins/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const patch = parse(adminUpdateSchema, req.body);
    const [rows] = await pool.query("SELECT id, active FROM admins WHERE id = ?", [id]);
    if (!rows.length) throw notFound("Admin");

    if (patch.active === false) {
      if (id === req.admin.id) throw new HttpError(409, "CANNOT_DISABLE_SELF", "You can't deactivate your own account");
      if (rows[0].active && (await activeCount()) <= 1) throw conflict("At least one active admin is required", undefined, "LAST_ADMIN");
    }
    const sets = [];
    const params = [];
    if (patch.name !== undefined) (sets.push("name = ?"), params.push(patch.name));
    if (patch.active !== undefined) (sets.push("active = ?"), params.push(patch.active ? 1 : 0));
    if (patch.password !== undefined) (sets.push("password_hash = ?"), params.push(await hashPassword(patch.password)));
    await pool.query(`UPDATE admins SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    if (patch.active === false || patch.password !== undefined) {
      await pool.query("DELETE FROM admin_sessions WHERE admin_id = ?", [id]);
    }
    const [out] = await pool.query("SELECT id, email, name, active, last_login_at, created_at FROM admins WHERE id = ?", [id]);
    res.json(serialize(out[0]));
  });

  r.delete("/admins/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    if (id === req.admin.id) throw new HttpError(409, "CANNOT_DELETE_SELF", "You can't delete your own account");
    const [rows] = await pool.query("SELECT id, active FROM admins WHERE id = ?", [id]);
    if (!rows.length) throw notFound("Admin");
    if (rows[0].active && (await activeCount()) <= 1) throw conflict("At least one active admin is required", undefined, "LAST_ADMIN");
    await pool.query("DELETE FROM admins WHERE id = ?", [id]); // sessions cascade
    res.status(204).end();
  });

  return r;
}
