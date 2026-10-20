import { invalid, notFound } from "../errors.js";

const publicShape = (r) => ({
  id: r.id,
  customerName: r.customer_name,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.created_at,
});

/** Customer submission: always starts unapproved and invisible. */
export async function createReview(pool, input) {
  const [products] = await pool.query("SELECT id FROM products WHERE sku = ? AND active = 1", [input.productSku]);
  if (!products.length) throw invalid("Unknown product", [{ path: "productSku", message: "No such product" }]);
  await pool.query(
    "INSERT INTO reviews (product_id, customer_name, rating, comment, approved) VALUES (?, ?, ?, ?, 0)",
    [products[0].id, input.customerName, input.rating, input.comment]
  );
}

export async function listApprovedReviews(pool, sku) {
  const [rows] = await pool.query(
    `SELECT r.* FROM reviews r JOIN products p ON p.id = r.product_id
     WHERE p.sku = ? AND r.approved = 1 ORDER BY r.created_at DESC, r.id DESC LIMIT 50`,
    [sku]
  );
  return rows.map(publicShape);
}

// --- admin ---------------------------------------------------------------------
const adminShape = (r) => ({
  ...publicShape(r),
  productId: r.product_id,
  productSku: r.sku,
  productName: r.product_name,
  productSlug: r.slug,
  approved: Boolean(r.approved),
});

export async function listReviewsAdmin(pool, f) {
  const where = f.approved === undefined ? "" : "WHERE r.approved = ?";
  const params = f.approved === undefined ? [] : [f.approved ? 1 : 0];
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM reviews r ${where}`, params);
  const [pending] = await pool.query("SELECT COUNT(*) AS n FROM reviews WHERE approved = 0");
  const [rows] = await pool.query(
    `SELECT r.*, p.sku, p.slug, p.name AS product_name
     FROM reviews r JOIN products p ON p.id = r.product_id ${where}
     ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...params, f.limit, (f.page - 1) * f.limit]
  );
  return {
    items: rows.map(adminShape),
    total,
    pendingCount: pending[0].n,
    page: f.page,
    limit: f.limit,
    totalPages: Math.max(1, Math.ceil(total / f.limit)),
  };
}

export async function setReviewApproved(pool, id, approved) {
  const [result] = await pool.query("UPDATE reviews SET approved = ? WHERE id = ?", [approved ? 1 : 0, id]);
  if (result.affectedRows === 0) throw notFound("Review");
}

export async function deleteReview(pool, id) {
  const [result] = await pool.query("DELETE FROM reviews WHERE id = ?", [id]);
  if (result.affectedRows === 0) throw notFound("Review");
}
