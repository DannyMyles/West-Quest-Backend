import { HttpError, invalid, notFound, parse, rethrowDuplicate } from "../errors.js";
import { productCreateSchema } from "../schemas.js";
import { slugify } from "../lib/slug.js";
import { listForProducts as listPlansForProducts } from "./paymentPlans.js";

// --- serialization -------------------------------------------------------
function parseSpecs(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const offerLive = (row) =>
  row.was_price != null && row.was_price > row.rrp && (row.offer_ends_at == null || new Date(row.offer_ends_at) > new Date());

/** Storefront-compatible product shape (matches src/lib/types.ts `Product`).
 *  Publicly an offer only shows while it's live; the admin always sees the
 *  stored values so an expired offer can be edited or cleared. */
export function serializeProduct(row, images, paymentPlans, { admin = false } = {}) {
  const live = offerLive(row);
  const out = {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    category: row.category_slug,
    categoryName: row.category_name,
    brand: row.brand,
    modelCode: row.model_code,
    ram: row.ram,
    storage: row.storage,
    rrp: row.rrp,
    wasPrice: admin || live ? row.was_price : null,
    offerEndsAt: admin || live ? row.offer_ends_at : null,
    description: row.description,
    specs: parseSpecs(row.specs),
    inStock: Boolean(row.in_stock),
    stockCount: row.stock_count,
    badge: row.badge,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    reviewCount: row.review_count,
    featured: Boolean(row.featured),
    featureRank: row.feature_rank,
    images: images.map((i) => i.url),
    paymentPlans,
    // Public too, so the sitemap can report real last-change dates.
    updatedAt: row.updated_at,
  };
  if (admin) {
    out.active = Boolean(row.active);
    out.adminNotes = row.admin_notes;
    out.createdAt = row.created_at;
  }
  return out;
}

const SELECT = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

const ORDER = {
  featured: "p.featured DESC, p.feature_rank IS NULL, p.feature_rank ASC, p.name ASC",
  "rrp-asc": "p.rrp ASC, p.name ASC",
  "rrp-desc": "p.rrp DESC, p.name ASC",
  name: "p.name ASC",
  newest: "p.created_at DESC, p.id DESC",
  // Biggest saving first; products not on offer follow.
  discount: `(CASE WHEN p.was_price > p.rrp AND (p.offer_ends_at IS NULL OR p.offer_ends_at > UTC_TIMESTAMP()) THEN p.was_price - p.rrp ELSE 0 END) DESC, p.name ASC`,
};

function buildWhere(f, { publicOnly }) {
  const where = [];
  const params = [];
  // Public listings hide products that have no photo yet; they appear on
  // their own once an image is uploaded.
  if (publicOnly) where.push("p.active = 1", "c.active = 1", "EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)");
  else if (f.active !== undefined) {
    where.push("p.active = ?");
    params.push(f.active ? 1 : 0);
  }
  if (f.category) {
    where.push("c.slug = ?");
    params.push(f.category);
  }
  if (f.brand) {
    where.push("p.brand = ?");
    params.push(f.brand);
  }
  if (f.ram) {
    where.push("p.ram = ?");
    params.push(f.ram);
  }
  if (f.storage) {
    where.push("p.storage = ?");
    params.push(f.storage);
  }
  if (f.minRrp !== undefined) {
    where.push("p.rrp >= ?");
    params.push(f.minRrp);
  }
  if (f.maxRrp !== undefined) {
    where.push("p.rrp <= ?");
    params.push(f.maxRrp);
  }
  if (f.inStock) where.push("p.in_stock = 1 AND (p.stock_count IS NULL OR p.stock_count > 0)");
  if (f.featured) where.push("p.featured = 1");
  if (f.onOffer) where.push("p.was_price > p.rrp AND (p.offer_ends_at IS NULL OR p.offer_ends_at > UTC_TIMESTAMP())");

  // Every whitespace-separated term must match somewhere (AND), like the storefront search.
  const terms = (f.q ?? "").split(/\s+/).filter(Boolean).slice(0, 6);
  for (const term of terms) {
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR p.slug LIKE ? OR p.brand LIKE ? OR p.description LIKE ? OR c.name LIKE ?)");
    const like = `%${escapeLike(term)}%`;
    params.push(like, like, like, like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

// --- queries ---------------------------------------------------------------
export async function listProducts({ pool, images }, filters, { publicOnly }) {
  const { sql: whereSql, params } = buildWhere(filters, { publicOnly });
  const offset = (filters.page - 1) * filters.limit;

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id ${whereSql}`,
    params
  );
  const [rows] = await pool.query(`${SELECT} ${whereSql} ORDER BY ${ORDER[filters.sort]} LIMIT ? OFFSET ?`, [
    ...params,
    filters.limit,
    offset,
  ]);

  const ids = rows.map((r) => r.id);
  const [withImages, withPlans] = await Promise.all([images.listForProducts(ids), listPlansForProducts(pool, ids)]);
  return {
    items: rows.map((r) => serializeProduct(r, withImages.get(r.id), withPlans.get(r.id), { admin: !publicOnly })),
    total,
    page: filters.page,
    limit: filters.limit,
    totalPages: Math.max(1, Math.ceil(total / filters.limit)),
  };
}

async function fetchOne({ pool, images }, whereSql, param, { publicOnly }) {
  const [rows] = await pool.query(
    `${SELECT} WHERE ${whereSql}${publicOnly ? " AND p.active = 1 AND c.active = 1 AND EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)" : ""} LIMIT 1`,
    [param]
  );
  if (!rows.length) throw notFound("Product");
  const [imgs, plans] = await Promise.all([images.list(rows[0].id), listForProduct(pool, rows[0].id)]);
  return serializeProduct(rows[0], imgs, plans, { admin: !publicOnly });
}

async function listForProduct(pool, productId) {
  return (await listPlansForProducts(pool, [productId])).get(productId);
}

export const getProductById = (ctx, id, opts = { publicOnly: false }) => fetchOne(ctx, "p.id = ?", id, opts);
export const getProductBySlug = (ctx, slug, opts = { publicOnly: true }) => fetchOne(ctx, "p.slug = ?", slug, opts);

// --- writes ----------------------------------------------------------------
async function categoryIdBySlug(pool, slug) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE slug = ?", [slug]);
  if (!rows.length) throw invalid("Unknown category", [{ path: "category", message: `No category with slug "${slug}"` }]);
  return rows[0].id;
}

/** ISO timestamp → MariaDB DATETIME in UTC (the column compares against UTC_TIMESTAMP()). */
const toDbDate = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace("T", " ") : null);
const nullIfEmpty = (v) => (v === undefined || v === null || v === "" ? null : v);
const bit = (b) => (b ? 1 : 0);

export async function createProduct(ctx, input) {
  const { pool } = ctx;
  const categoryId = await categoryIdBySlug(pool, input.category);

  const slug = input.slug ?? (slugify(`${input.name}-${input.sku}`) || null);
  if (!slug) throw invalid("Could not derive a slug — provide one", [{ path: "slug", message: "Required" }]);

  try {
    const [result] = await pool.query(
      `INSERT INTO products
        (slug, sku, name, category_id, brand, model_code, ram, storage, rrp, was_price, offer_ends_at, description, specs,
         in_stock, stock_count, badge, featured, feature_rank, active, admin_notes, rating, review_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        slug,
        input.sku,
        input.name,
        categoryId,
        nullIfEmpty(input.brand),
        nullIfEmpty(input.modelCode),
        nullIfEmpty(input.ram),
        nullIfEmpty(input.storage),
        input.rrp,
        input.wasPrice ?? null,
        toDbDate(input.offerEndsAt),
        input.description ?? "",
        JSON.stringify(input.specs ?? []),
        bit(input.inStock ?? true),
        input.stockCount ?? null,
        input.badge ?? null,
        bit(input.featured ?? false),
        input.featureRank ?? null,
        bit(input.active ?? true),
        nullIfEmpty(input.adminNotes),
        input.rating ?? null,
        input.reviewCount ?? null,
      ]
    );
    return getProductById(ctx, result.insertId);
  } catch (err) {
    rethrowDuplicate(err, "A product with this SKU or slug already exists");
  }
}

const COLUMN = {
  name: "name",
  sku: "sku",
  brand: "brand",
  modelCode: "model_code",
  ram: "ram",
  storage: "storage",
  rrp: "rrp",
  wasPrice: "was_price",
  offerEndsAt: "offer_ends_at",
  description: "description",
  specs: "specs",
  inStock: "in_stock",
  stockCount: "stock_count",
  badge: "badge",
  featured: "featured",
  featureRank: "feature_rank",
  active: "active",
  adminNotes: "admin_notes",
  rating: "rating",
  reviewCount: "review_count",
};
const TO_DB = {
  specs: (v) => JSON.stringify(v ?? []),
  inStock: bit,
  featured: bit,
  active: bit,
  brand: nullIfEmpty,
  modelCode: nullIfEmpty,
  ram: nullIfEmpty,
  storage: nullIfEmpty,
  adminNotes: nullIfEmpty,
  description: (v) => v ?? "",
  offerEndsAt: (v) => toDbDate(v),
};

export async function updateProduct(ctx, id, input) {
  const { pool } = ctx;
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    if (input[key] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push((TO_DB[key] ?? ((v) => v))(input[key]));
  }
  if (input.category !== undefined) {
    sets.push("category_id = ?");
    params.push(await categoryIdBySlug(pool, input.category));
  }
  if (!sets.length) throw invalid("No fields to update");

  try {
    const [result] = await pool.query(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    if (result.affectedRows === 0) throw notFound("Product");
  } catch (err) {
    rethrowDuplicate(err);
  }
  return getProductById(ctx, id);
}

/** Deletes the product; its stored photos and payment plans go with it (ON DELETE CASCADE). */
export async function deleteProduct({ pool }, id) {
  const [result] = await pool.query("DELETE FROM products WHERE id = ?", [id]);
  if (result.affectedRows === 0) throw notFound("Product");
}

/** Row lookup used by the image routes. */
export async function getProductRow(pool, id) {
  const [rows] = await pool.query("SELECT id, name, category_id FROM products WHERE id = ?", [id]);
  if (!rows.length) throw notFound("Product");
  return rows[0];
}

/**
 * CSV/bulk import: each row is created, or — when its SKU already exists —
 * updated with just the fields the row supplies. One bad row never blocks the
 * rest; the response lists per-row errors.
 */
export async function bulkUpsertProducts(ctx, rows) {
  let created = 0;
  let updated = 0;
  const errors = [];
  for (const [i, raw] of rows.entries()) {
    try {
      const input = parse(productCreateSchema, raw);
      const [existing] = await ctx.pool.query("SELECT id FROM products WHERE sku = ?", [input.sku]);
      if (existing.length) {
        // eslint-disable-next-line no-unused-vars
        const { slug, ...fields } = input;
        await updateProduct(ctx, existing[0].id, fields);
        updated++;
      } else {
        await createProduct(ctx, input);
        created++;
      }
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const first = err.details?.[0];
      errors.push({ row: i + 1, sku: raw?.sku ?? null, message: first ? `${first.path}: ${first.message}` : err.message });
    }
  }
  return { created, updated, errors };
}
