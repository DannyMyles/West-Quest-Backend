import { conflict, invalid, notFound, rethrowDuplicate } from "../errors.js";
import { withTransaction } from "../db.js";

function serialize(row, { admin }) {
  const out = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.short_name,
    description: row.description,
    icon: row.icon,
    order: row.sort_order,
    productCount: Number(row.product_count ?? 0),
  };
  if (admin) {
    out.active = Boolean(row.active);
    out.createdAt = row.created_at;
    out.updatedAt = row.updated_at;
  }
  return out;
}

/**
 * Public: active categories with their active-product counts, plus `image` — the
 * primary photo of the category's best product (featured first, then lowest
 * feature rank, then oldest), so tiles show real stock instead of stock photos.
 * Admin: everything.
 */
export async function listCategories(pool, { admin, images }) {
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(p.id) AS product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id ${admin ? "" : "AND p.active = 1 AND EXISTS (SELECT 1 FROM product_images pi2 WHERE pi2.product_id = p.id)"}
     ${admin ? "" : "WHERE c.active = 1"}
     GROUP BY c.id
     ${admin ? "" : "HAVING product_count > 0"}
     ORDER BY c.sort_order ASC, c.name ASC`
  );
  const out = rows.map((r) => serialize(r, { admin }));
  if (images && out.length) {
    const [pics] = await pool.query(
      `SELECT pi.id, pi.updated_at, p.category_id
       FROM product_images pi
       JOIN products p ON p.id = pi.product_id AND p.active = 1
       WHERE pi.position = 1 AND p.category_id IN (?)
       ORDER BY p.featured DESC, p.feature_rank IS NULL, p.feature_rank, p.id`,
      [rows.map((r) => r.id)]
    );
    const best = new Map();
    for (const pic of pics) if (!best.has(pic.category_id)) best.set(pic.category_id, pic);
    out.forEach((c, i) => {
      const pic = best.get(rows[i].id);
      c.image = pic ? images.url(pic.id, pic.updated_at) : null;
    });
  }
  return out;
}

export async function getCategory(pool, id) {
  const [rows] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id) AS product_count
     FROM categories c WHERE c.id = ?`,
    [id]
  );
  if (!rows.length) throw notFound("Category");
  return serialize(rows[0], { admin: true });
}

export async function createCategory(pool, input) {
  try {
    const [result] = await pool.query(
      `INSERT INTO categories (slug, name, short_name, description, icon, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.slug,
        input.name,
        input.shortName ?? input.name,
        input.description ?? "",
        input.icon ?? "package",
        input.sortOrder ?? 0,
        (input.active ?? true) ? 1 : 0,
      ]
    );
    return getCategory(pool, result.insertId);
  } catch (err) {
    rethrowDuplicate(err);
  }
}

const COLUMN = {
  name: "name",
  shortName: "short_name",
  description: "description",
  icon: "icon",
  sortOrder: "sort_order",
  active: "active",
};

export async function updateCategory(pool, id, input) {
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    if (input[key] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(key === "active" ? (input[key] ? 1 : 0) : input[key]);
  }
  if (!sets.length) throw invalid("No fields to update");
  const [result] = await pool.query(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  if (result.affectedRows === 0) throw notFound("Category");
  return getCategory(pool, id);
}

/**
 * A category with products can't just vanish — the caller must say where the
 * products go (`reassignTo` = another category's slug). Move + delete is atomic.
 */
export async function deleteCategory(pool, id, reassignTo) {
  await withTransaction(pool, async (conn) => {
    const [cats] = await conn.query("SELECT id FROM categories WHERE id = ? FOR UPDATE", [id]);
    if (!cats.length) throw notFound("Category");

    const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM products WHERE category_id = ?", [id]);
    if (n > 0) {
      if (!reassignTo) {
        throw conflict(
          `This category has ${n} product(s). Pass ?reassignTo=<category slug> to move them first.`,
          { productCount: n },
          "CATEGORY_IN_USE"
        );
      }
      const [target] = await conn.query("SELECT id FROM categories WHERE slug = ?", [reassignTo]);
      if (!target.length) throw invalid("Unknown reassignTo category", [{ path: "reassignTo", message: "No such category" }]);
      if (target[0].id === id) throw invalid("reassignTo must be a different category");
      await conn.query("UPDATE products SET category_id = ? WHERE category_id = ?", [target[0].id, id]);
    }
    await conn.query("DELETE FROM categories WHERE id = ?", [id]);
  });
}
