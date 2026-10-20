// Seeds MariaDB with a general electronics catalogue (phones, laptops,
// audio, gaming, cameras, storage, accessories) built from publicly
// observable facts (name, price, category) about what's currently for sale
// in the Kenyan market — no photos, no copied marketing copy. Every product
// is created cash-only (no payment plan); add financing terms per product
// in the admin if West Quest wants to offer deposit+daily on any of them.
//
//   npm run import-ppk -- --dry-run
//   npm run import-ppk
//   npm run import-ppk -- --update
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";

const { values: args } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, update: { type: "boolean", default: false } },
});
const DRY = args["dry-run"];
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);
  const stats = { categories: 0, created: 0, updated: 0, skipped: 0 };
  try {
    const categories = JSON.parse(await fs.readFile(path.join(dataDir, "ppk-categories.json"), "utf8"));
    const [existingCats] = await pool.query("SELECT COALESCE(MAX(sort_order), 1) AS max FROM categories");
    let order = existingCats[0].max + 1;
    for (const c of categories) {
      if (!DRY) {
        await pool.query(
          `INSERT INTO categories (slug, name, short_name, description, icon, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE slug = slug`,
          [c.slug, c.name, c.shortName, c.description, c.icon, order++]
        );
      }
      stats.categories++;
    }
    const [catRows] = await pool.query("SELECT id, slug FROM categories");
    const catId = Object.fromEntries(catRows.map((r) => [r.slug, r.id]));
    const knownSlugs = new Set([...catRows.map((r) => r.slug), ...categories.map((c) => c.slug)]);

    const rows = JSON.parse(await fs.readFile(path.join(dataDir, "ppk-catalogue.json"), "utf8"));

    for (const row of rows) {
      if (DRY ? !knownSlugs.has(row.category) : !catId[row.category]) {
        console.warn(`  ! unknown category "${row.category}" for ${row.sku} — skipped`);
        stats.skipped++;
        continue;
      }
      const [existing] = await pool.query("SELECT id FROM products WHERE sku = ? OR slug = ?", [row.sku, row.slug]);
      const exists = existing.length > 0;
      if (exists && !args.update) {
        stats.skipped++;
        continue;
      }
      if (DRY) {
        console.log(`  ${exists ? "update" : "create"}  ${row.sku.padEnd(14)} ${String(row.rrp).padStart(7)}  ${row.category.padEnd(12)} ${row.name}`);
        exists ? stats.updated++ : stats.created++;
        continue;
      }

      if (exists) {
        await pool.query(
          `UPDATE products SET name = ?, category_id = ?, brand = ?, rrp = ?, description = ?, in_stock = ? WHERE id = ?`,
          [row.name, catId[row.category], row.brand, row.rrp, row.description, row.inStock ? 1 : 0, existing[0].id]
        );
        stats.updated++;
      } else {
        await pool.query(
          `INSERT INTO products (slug, sku, name, category_id, brand, rrp, description, specs, in_stock)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
          [row.slug, row.sku, row.name, catId[row.category], row.brand, row.rrp, row.description, row.inStock ? 1 : 0]
        );
        stats.created++;
      }
    }
  } finally {
    await pool.end();
  }
  console.log(
    `\n${DRY ? "[dry run] " : ""}categories: ${stats.categories}  products created: ${stats.created}  updated: ${stats.updated}  skipped: ${stats.skipped}`
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
