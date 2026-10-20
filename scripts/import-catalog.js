// Seeds MariaDB from the West Quest catalogue:
//   - categories from data/categories.json
//   - products + payment plans from data/catalogue.json (hand-transcribed from
//     the client's financing price list)
//
// Create-only by default: products whose SKU/slug already exist are skipped, so
// re-running never overwrites edits made in the admin. Pass --update to refresh
// the product fields (name/brand/rrp/specs/category) and always refresh the
// payment plans (plans are meant to be kept current with the price list).
//
//   npm run import-catalog -- --dry-run
//   npm run import-catalog
//   npm run import-catalog -- --update
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { slugify } from "../src/lib/slug.js";

const { values: args } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, update: { type: "boolean", default: false } },
});
const DRY = args["dry-run"];
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

const BRAND_CODE = { infinix: "INF", itel: "ITL", oppo: "OPP", tecno: "TEC", villaon: "VIL" };

/**
 * The catalogue's "RAM+Storage" column is written inconsistently (some rows
 * read RAM-first like "12+256", others Storage-first like "128+8") but RAM
 * configs in this list (2-12GB) never overlap storage configs (64-512GB), so
 * the smaller of the two numbers is always RAM and the larger always storage.
 */
function splitVariant(variant) {
  const [a, b] = variant.split("+").map((n) => Number(n.trim()));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ram: null, storage: null };
  const ram = Math.min(a, b);
  const storage = Math.max(a, b);
  return { ram: `${ram}GB`, storage: `${storage}GB` };
}

function buildDescription(brand, name) {
  return `${brand} ${name}. Buy on deposit with daily payments — message us on WhatsApp for full specifications.`;
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);
  const stats = { categories: 0, created: 0, updated: 0, skipped: 0, plans: 0 };
  try {
    // categories
    const categories = JSON.parse(await fs.readFile(path.join(dataDir, "categories.json"), "utf8"));
    for (const [i, c] of categories.entries()) {
      if (!DRY) {
        await pool.query(
          `INSERT INTO categories (slug, name, short_name, description, icon, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE slug = slug`, // never clobber admin edits
          [c.slug, c.name, c.shortName, c.description, c.icon, i]
        );
      }
      stats.categories++;
    }
    const [catRows] = await pool.query("SELECT id, slug FROM categories");
    const catId = Object.fromEntries(catRows.map((r) => [r.slug, r.id]));

    // products + payment plans
    const rows = JSON.parse(await fs.readFile(path.join(dataDir, "catalogue.json"), "utf8"));

    const usedSlugs = new Set();
    const usedSkus = new Set();
    const unique = (base, used) => {
      let v = base;
      let n = 2;
      while (used.has(v)) v = `${base}-${n++}`;
      used.add(v);
      return v;
    };

    for (const row of rows) {
      const { ram, storage } = splitVariant(row.variant);
      const name = `${row.name} (${row.variant})`;
      const slug = unique(slugify(`${row.brand}-${row.name}-${row.variant}`), usedSlugs);
      const sku = unique(
        `${BRAND_CODE[row.brand.toLowerCase()] ?? "MISC"}-${row.modelCode}-${row.variant}`.toUpperCase().replace(/\s+/g, ""),
        usedSkus
      );
      const specs = [
        ram ? { label: "RAM", value: ram } : null,
        storage ? { label: "Storage", value: storage } : null,
        { label: "Model code", value: row.modelCode },
      ].filter(Boolean);
      const description = buildDescription(row.brand, row.name);

      const [existing] = await pool.query("SELECT id FROM products WHERE sku = ? OR slug = ?", [sku, slug]);
      const exists = existing.length > 0;
      if (exists && !args.update) {
        stats.skipped++;
        continue;
      }
      if (DRY) {
        console.log(`  ${exists ? "update" : "create"}  ${sku.padEnd(28)} ${String(row.rrp).padStart(7)}  ${row.category.padEnd(11)} ${name}`);
        if (exists) stats.updated++;
        else stats.created++;
        continue;
      }

      let productId;
      if (exists) {
        productId = existing[0].id;
        await pool.query(
          `UPDATE products SET name = ?, category_id = ?, brand = ?, model_code = ?, ram = ?, storage = ?, rrp = ?,
                                description = ?, specs = ? WHERE id = ?`,
          [name, catId[row.category], row.brand, row.modelCode, ram, storage, row.rrp, description, JSON.stringify(specs), productId]
        );
        stats.updated++;
      } else {
        const [result] = await pool.query(
          `INSERT INTO products (slug, sku, name, category_id, brand, model_code, ram, storage, rrp, description, specs)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [slug, sku, name, catId[row.category], row.brand, row.modelCode, ram, storage, row.rrp, description, JSON.stringify(specs)]
        );
        productId = result.insertId;
        stats.created++;
      }

      // Retail plan is always present; VIP only when the source row has one
      // (VIP is the exception — most products are retail-only).
      const tiers = [["retail", row.retail], row.vip ? ["vip", row.vip] : null].filter(Boolean);
      for (const [tier, plan] of tiers) {
        await pool.query(
          `INSERT INTO payment_plans (product_id, tier, deposit_percent, deposit_amount, daily_6, daily_9, daily_12)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             deposit_percent = VALUES(deposit_percent), deposit_amount = VALUES(deposit_amount),
             daily_6 = VALUES(daily_6), daily_9 = VALUES(daily_9), daily_12 = VALUES(daily_12)`,
          [productId, tier, plan.depositPercent, plan.deposit, plan.daily6, plan.daily9, plan.daily12]
        );
        stats.plans++;
      }
    }
  } finally {
    await pool.end();
  }
  console.log(
    `\n${DRY ? "[dry run] " : ""}categories: ${stats.categories}  products created: ${stats.created}  updated: ${stats.updated}  skipped (already exist): ${stats.skipped}  plan rows written: ${stats.plans}`
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
