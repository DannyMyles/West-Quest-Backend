import { withTransaction } from "../db.js";
import { conflict, notFound } from "../errors.js";
import { generateRef, isDupRef, nullIfEmpty, phoneKey, placeApplication, serializeApplication } from "./applications.js";

export function serializeOrder(row, items, { admin = false } = {}) {
  const out = {
    id: row.id,
    ref: row.ref,
    items: items.map((i) => ({
      sku: i.product_sku,
      name: i.product_name,
      slug: i.product_slug,
      unitPrice: i.unit_price,
      quantity: i.quantity,
    })),
    total: row.total,
    customer: { name: row.customer_name, phone: row.customer_phone, location: row.location },
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (admin) out.adminNotes = row.admin_notes;
  return out;
}

async function loadOrders(db, rows, opts) {
  if (!rows.length) return [];
  const [items] = await db.query("SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id", [rows.map((r) => r.id)]);
  return rows.map((r) => serializeOrder(r, items.filter((i) => i.order_id === r.id), opts));
}

async function placeOrder(conn, { customerId, customer, location, notes, items }, ref) {
  const slugs = items.map((i) => i.productSlug);
  const [products] = await conn.query(
    `SELECT p.id, p.sku, p.slug, p.name, p.rrp, p.active, p.in_stock, c.active AS category_active
     FROM products p JOIN categories c ON c.id = p.category_id WHERE p.slug IN (?)`,
    [slugs]
  );
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const lines = items.map((i) => {
    const p = bySlug.get(i.productSlug);
    if (!p || !p.active || !p.category_active || !p.in_stock) {
      throw conflict("An item in your cart is no longer available", { productSlug: i.productSlug }, "ITEM_UNAVAILABLE");
    }
    return { product: p, quantity: i.quantity };
  });
  // Prices always come from the database, never from the request.
  const total = lines.reduce((sum, l) => sum + l.product.rrp * l.quantity, 0);

  const [result] = await conn.query(
    `INSERT INTO orders (ref, customer_id, customer_name, customer_phone, phone_key, location, notes, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ref, customerId, customer.name, customer.phone, phoneKey(customer.phone), nullIfEmpty(location), nullIfEmpty(notes), total]
  );
  for (const l of lines) {
    await conn.query(
      `INSERT INTO order_items (order_id, product_id, product_sku, product_name, product_slug, unit_price, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [result.insertId, l.product.id, l.product.sku, l.product.name, l.product.slug, l.product.rrp, l.quantity]
    );
  }
  const [rows] = await conn.query("SELECT * FROM orders WHERE id = ?", [result.insertId]);
  return (await loadOrders(conn, rows))[0];
}

/**
 * Checks out a signed-in customer's cart in one transaction: one financing
 * application per item on a plan, plus a single cash order for everything
 * paid in full. Retries with fresh references on the rare ref collision.
 */
export async function checkout({ pool }, customer, input) {
  const planItems = input.items.filter((i) => i.mode === "plan");
  const cashItems = input.items.filter((i) => i.mode === "cash");
  const contact = { name: customer.name, phone: customer.phone };

  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(pool, async (conn) => {
        const applications = [];
        for (const item of planItems) {
          applications.push(
            await placeApplication(
              conn,
              {
                customerId: customer.id,
                productSlug: item.productSlug,
                tier: item.tier,
                termMonths: item.termMonths,
                customer: { ...contact, idNumber: input.idNumber, location: input.location },
                notes: input.notes,
              },
              generateRef("WQ-")
            )
          );
        }
        const order = cashItems.length
          ? await placeOrder(conn, { customerId: customer.id, customer: contact, location: input.location, notes: input.notes, items: cashItems }, generateRef("WC-"))
          : null;
        if (input.location) await conn.query("UPDATE customers SET location = ? WHERE id = ?", [input.location, customer.id]);
        return { applications, order };
      });
    } catch (err) {
      if (isDupRef(err) && attempt < 4) continue;
      if (isDupRef(err)) throw conflict("Could not generate a unique reference — please try again", undefined, "DUPLICATE");
      throw err;
    }
  }
}

/** Everything a customer has submitted while signed in. */
export async function customerActivity(pool, customerId) {
  const [apps] = await pool.query("SELECT * FROM applications WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 100", [customerId]);
  const [orders] = await pool.query("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 100", [customerId]);
  return { applications: apps.map((r) => serializeApplication(r)), orders: await loadOrders(pool, orders) };
}

// --- admin ------------------------------------------------------------------------
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

export async function listOrders(pool, f) {
  const where = [];
  const params = [];
  if (f.status) {
    where.push("status = ?");
    params.push(f.status);
  }
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    const digits = f.q.replace(/\D/g, "").replace(/^(254|0)/, "");
    const parts = ["ref LIKE ?", "customer_name LIKE ?"];
    params.push(like, like);
    if (digits.length >= 3) {
      parts.push("phone_key LIKE ?");
      params.push(`%${digits}%`);
    }
    where.push(`(${parts.join(" OR ")})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM orders ${whereSql}`, params);
  const [rows] = await pool.query(`SELECT * FROM orders ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [
    ...params,
    f.limit,
    (f.page - 1) * f.limit,
  ]);
  return {
    items: await loadOrders(pool, rows, { admin: true }),
    total,
    page: f.page,
    limit: f.limit,
    totalPages: Math.max(1, Math.ceil(total / f.limit)),
  };
}

export async function getOrder(pool, id) {
  const [rows] = await pool.query("SELECT * FROM orders WHERE id = ?", [id]);
  if (!rows.length) throw notFound("Order");
  return (await loadOrders(pool, rows, { admin: true }))[0];
}

export async function updateOrder(pool, id, patch) {
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
  const [result] = await pool.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  if (result.affectedRows === 0) throw notFound("Order");
  return getOrder(pool, id);
}
