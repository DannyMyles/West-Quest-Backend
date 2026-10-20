import crypto from "node:crypto";
import { conflict, invalid, notFound } from "../errors.js";

// Unambiguous alphabet (no 0/O/1/I) for server-generated references.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateRef(prefix = "WQ-") {
  let s = prefix;
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return s;
}

/** Last 9 digits: matches 0712 345 678, +254 712 345 678 and 712345678 alike. */
export const phoneKey = (phone) => phone.replace(/\D/g, "").slice(-9);

export const isDupRef = (err) => err?.code === "ER_DUP_ENTRY" && /uq_(applications|orders)_ref/.test(err.sqlMessage ?? "");
export const nullIfEmpty = (v) => (v === undefined || v === null || v === "" ? null : v);

const DAILY_COLUMN = { 6: "daily_6", 9: "daily_9", 12: "daily_12" };

// --- serialization ----------------------------------------------------------
export function serializeApplication(row, { admin = false } = {}) {
  const out = {
    id: row.id,
    ref: row.ref,
    product: { sku: row.product_sku, name: row.product_name, slug: row.product_slug },
    tier: row.tier,
    termMonths: row.term_months,
    rrp: row.rrp,
    depositAmount: row.deposit_amount,
    dailyAmount: row.daily_amount,
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      idNumber: row.id_number,
      location: row.location,
    },
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (admin) out.adminNotes = row.admin_notes;
  return out;
}

// --- submission ---------------------------------------------------------------
// Applications are created at checkout (services/orders.js). Only the product
// slug + chosen tier/term come from the client: the RRP and deposit/daily
// figures are snapshotted from the product's current payment plan. No stock is
// touched — approval is a manual sales-team decision made offline.

/** Inserts one application inside an open transaction (`conn`). */
export async function placeApplication(conn, input, ref) {
  const [products] = await conn.query(
    `SELECT p.id, p.sku, p.slug, p.name, p.rrp, p.active, c.active AS category_active
     FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ? LIMIT 1`,
    [input.productSlug]
  );
  const product = products[0];
  if (!product || !product.active || !product.category_active) {
    throw conflict("This product is no longer available", { productSlug: input.productSlug }, "ITEM_UNAVAILABLE");
  }

  const [plans] = await conn.query("SELECT * FROM payment_plans WHERE product_id = ? AND tier = ?", [product.id, input.tier]);
  const plan = plans[0];
  if (!plan) {
    throw invalid(`This product has no ${input.tier} plan`, [{ path: "tier", message: "Not offered for this product" }]);
  }
  const dailyAmount = plan[DAILY_COLUMN[input.termMonths]];

  const c = input.customer;
  const [result] = await conn.query(
    `INSERT INTO applications
      (ref, customer_id, product_id, product_sku, product_name, product_slug, tier, term_months, rrp,
       deposit_amount, daily_amount, customer_name, customer_phone, phone_key, id_number, location, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ref, input.customerId ?? null, product.id, product.sku, product.name, product.slug, input.tier, input.termMonths, product.rrp,
      plan.deposit_amount, dailyAmount, c.name, c.phone, phoneKey(c.phone), nullIfEmpty(c.idNumber), nullIfEmpty(c.location),
      nullIfEmpty(input.notes),
    ]
  );

  const [[row]] = await conn.query("SELECT * FROM applications WHERE id = ?", [result.insertId]);
  return serializeApplication(row);
}

// --- admin ------------------------------------------------------------------------
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

export async function listApplications(pool, f) {
  const where = [];
  const params = [];
  if (f.status) {
    where.push("status = ?");
    params.push(f.status);
  }
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    const digits = f.q.replace(/\D/g, "").replace(/^(254|0)/, "");
    const parts = ["ref LIKE ?", "customer_name LIKE ?", "product_name LIKE ?"];
    params.push(like, like, like);
    if (digits.length >= 3) {
      parts.push("phone_key LIKE ?");
      params.push(`%${digits}%`);
    }
    where.push(`(${parts.join(" OR ")})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM applications ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM applications ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, f.limit, (f.page - 1) * f.limit]
  );
  return {
    items: rows.map((r) => serializeApplication(r, { admin: true })),
    total,
    page: f.page,
    limit: f.limit,
    totalPages: Math.max(1, Math.ceil(total / f.limit)),
  };
}

export async function getApplication(pool, id) {
  const [rows] = await pool.query("SELECT * FROM applications WHERE id = ?", [id]);
  if (!rows.length) throw notFound("Application");
  return serializeApplication(rows[0], { admin: true });
}

export async function updateApplication(pool, id, patch) {
  const sets = [];
  const params = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.adminNotes !== undefined) {
    sets.push("admin_notes = ?");
    params.push(nullIfEmpty(patch.adminNotes));
  }
  const [result] = await pool.query(`UPDATE applications SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  if (result.affectedRows === 0) throw notFound("Application");
  return getApplication(pool, id);
}
