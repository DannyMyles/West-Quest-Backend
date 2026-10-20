import { withTransaction } from "../db.js";
import { invalid, notFound } from "../errors.js";

const nullIfEmpty = (v) => (v === undefined || v === null || v === "" ? null : v);

export function serializeBanner(r) {
  return {
    id: r.id,
    eyebrow: r.eyebrow,
    headline: r.headline,
    subcopy: r.subcopy,
    image: r.image,
    layout: r.layout,
    accent: r.accent,
    badge: r.badge,
    ctaLabel: r.cta_label,
    ctaHref: r.cta_href,
    cta2Label: r.cta2_label,
    cta2Href: r.cta2_href,
    dealEndsAt: r.deal_ends_at ? new Date(r.deal_ends_at).toISOString() : null,
    active: Boolean(r.active),
    order: r.sort_order,
  };
}

export async function listBanners(pool, { activeOnly }) {
  const [rows] = await pool.query(
    `SELECT * FROM banners ${activeOnly ? "WHERE active = 1" : ""} ORDER BY sort_order ASC, id ASC`
  );
  return rows.map(serializeBanner);
}

async function getBanner(pool, id) {
  const [rows] = await pool.query("SELECT * FROM banners WHERE id = ?", [id]);
  if (!rows.length) throw notFound("Banner");
  return serializeBanner(rows[0]);
}

export async function createBanner(pool, input) {
  const [[{ next }]] = await pool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM banners");
  const [result] = await pool.query(
    `INSERT INTO banners (eyebrow, headline, subcopy, image, layout, accent, badge, cta_label, cta_href, cta2_label, cta2_href,
                          deal_ends_at, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nullIfEmpty(input.eyebrow), input.headline, nullIfEmpty(input.subcopy), input.image,
      input.layout ?? "photo", nullIfEmpty(input.accent)?.toLowerCase() ?? null, nullIfEmpty(input.badge),
      nullIfEmpty(input.ctaLabel), nullIfEmpty(input.ctaHref), nullIfEmpty(input.cta2Label), nullIfEmpty(input.cta2Href),
      input.dealEndsAt ? new Date(input.dealEndsAt) : null,
      (input.active ?? true) ? 1 : 0, next,
    ]
  );
  return getBanner(pool, result.insertId);
}

const COLUMN = {
  eyebrow: "eyebrow", headline: "headline", subcopy: "subcopy", image: "image", layout: "layout", accent: "accent",
  badge: "badge", ctaLabel: "cta_label", ctaHref: "cta_href", cta2Label: "cta2_label", cta2Href: "cta2_href",
  dealEndsAt: "deal_ends_at", active: "active",
};
const TO_DB = {
  active: (v) => (v ? 1 : 0),
  dealEndsAt: (v) => (v ? new Date(v) : null),
  eyebrow: nullIfEmpty, subcopy: nullIfEmpty, badge: nullIfEmpty, ctaLabel: nullIfEmpty, ctaHref: nullIfEmpty,
  cta2Label: nullIfEmpty, cta2Href: nullIfEmpty, accent: (v) => nullIfEmpty(v)?.toLowerCase() ?? null,
};

export async function updateBanner(pool, id, input) {
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    if (input[key] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push((TO_DB[key] ?? ((v) => v))(input[key]));
  }
  if (!sets.length) throw invalid("No fields to update");
  const [result] = await pool.query(`UPDATE banners SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  if (result.affectedRows === 0) throw notFound("Banner");
  return getBanner(pool, id);
}

export async function deleteBanner(pool, id) {
  const [result] = await pool.query("DELETE FROM banners WHERE id = ?", [id]);
  if (result.affectedRows === 0) throw notFound("Banner");
}

/** `ids` must list every banner exactly once, in the new display order. */
export async function reorderBanners(pool, ids) {
  await withTransaction(pool, async (conn) => {
    const [rows] = await conn.query("SELECT id FROM banners FOR UPDATE");
    const current = new Set(rows.map((r) => r.id));
    if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((i) => current.has(i))) {
      throw invalid("`ids` must list every banner exactly once", [{ path: "ids", message: "Not a permutation of the current banners" }]);
    }
    for (const [i, id] of ids.entries()) await conn.query("UPDATE banners SET sort_order = ? WHERE id = ?", [i, id]);
  });
  return listBanners(pool, { activeOnly: false });
}
