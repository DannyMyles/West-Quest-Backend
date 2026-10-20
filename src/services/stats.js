const LOW_STOCK_THRESHOLD = 5;

/** Numbers for the admin overview, computed in SQL (no need to load every application). */
export async function getStats(pool) {
  const one = async (sql) => (await pool.query(sql))[0][0];
  const [products, categories, applications, reviews, orders] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM products"),
    one("SELECT COUNT(*) AS n FROM categories"),
    one(`SELECT
           SUM(status = 'pending') AS pending,
           SUM(status = 'contacted') AS contacted,
           SUM(status = 'approved') AS approved
         FROM applications`),
    one("SELECT COUNT(*) AS n FROM reviews WHERE approved = 0"),
    one("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
  ]);
  const [lowStock] = await pool.query(
    `SELECT id, slug, name, stock_count FROM products
     WHERE stock_count IS NOT NULL AND stock_count <= ? ORDER BY stock_count ASC, name ASC LIMIT 5`,
    [LOW_STOCK_THRESHOLD]
  );
  const [recent] = await pool.query(
    "SELECT id, ref, customer_name, product_name, status, created_at FROM applications ORDER BY created_at DESC, id DESC LIMIT 5"
  );
  return {
    products: products.n,
    categories: categories.n,
    pendingApplications: Number(applications.pending ?? 0),
    contactedApplications: Number(applications.contacted ?? 0),
    approvedApplications: Number(applications.approved ?? 0),
    pendingReviews: reviews.n,
    pendingOrders: orders.n,
    lowStock: lowStock.map((p) => ({ id: p.id, slug: p.slug, name: p.name, stockCount: p.stock_count })),
    recentApplications: recent.map((a) => ({
      id: a.id, ref: a.ref, customerName: a.customer_name, productName: a.product_name,
      status: a.status, createdAt: a.created_at,
    })),
  };
}
