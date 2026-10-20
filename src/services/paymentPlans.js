import { notFound } from "../errors.js";

function serialize(row) {
  return {
    tier: row.tier,
    depositPercent: Number(row.deposit_percent),
    depositAmount: row.deposit_amount,
    daily6: row.daily_6,
    daily9: row.daily_9,
    daily12: row.daily_12,
  };
}

/** Payment-plan rows for many products in one query → Map(productId → PaymentPlan[]). */
export async function listForProducts(pool, productIds) {
  const map = new Map(productIds.map((id) => [id, []]));
  if (!productIds.length) return map;
  const [rows] = await pool.query(
    `SELECT * FROM payment_plans WHERE product_id IN (?) ORDER BY product_id, FIELD(tier, 'retail', 'vip')`,
    [productIds]
  );
  for (const r of rows) map.get(r.product_id).push(serialize(r));
  return map;
}

export async function listForProduct(pool, productId) {
  return (await listForProducts(pool, [productId])).get(productId);
}

/** Creates or replaces the plan for `(productId, tier)`. */
export async function upsertPlan({ pool }, productId, tier, input) {
  const [product] = await pool.query("SELECT id FROM products WHERE id = ?", [productId]);
  if (!product.length) throw notFound("Product");

  await pool.query(
    `INSERT INTO payment_plans (product_id, tier, deposit_percent, deposit_amount, daily_6, daily_9, daily_12)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       deposit_percent = VALUES(deposit_percent),
       deposit_amount = VALUES(deposit_amount),
       daily_6 = VALUES(daily_6),
       daily_9 = VALUES(daily_9),
       daily_12 = VALUES(daily_12)`,
    [productId, tier, input.depositPercent, input.depositAmount, input.daily6, input.daily9, input.daily12]
  );
  return listForProduct(pool, productId);
}

export async function removePlan({ pool }, productId, tier) {
  await pool.query("DELETE FROM payment_plans WHERE product_id = ? AND tier = ?", [productId, tier]);
  return listForProduct(pool, productId);
}
