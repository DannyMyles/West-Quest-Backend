// Loads product photos from a local folder into MariaDB. This never fetches
// anything from the internet — you place legitimately-sourced images
// (manufacturer press kits, your own photography, a licensed supplier) into
// a folder per product first, then this script reads and stores them.
//
// Expected layout, one folder per product:
//   <IMAGES_ROOT>/<category-slug>/<Brand Product Name (variant)>/<same name> - 1.jpg
//                                                                 <same name> - 2.jpg
//                                                                 ...
// Run with no arguments to print the exact folder names every product
// expects (a checklist), so you know exactly what to create.
//
//   npm run import-images -- --list            # just print the expected folders
//   npm run import-images -- --dry-run          # preview what would be imported
//   npm run import-images                       # import (skips products that already have photos)
//   npm run import-images -- --replace          # delete existing photos first, then reload
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { ImageStore } from "../src/lib/imageStore.js";
import { detectImageType, IMAGE_EXTS } from "../src/lib/images.js";
import { safeName } from "../src/lib/slug.js";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    replace: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

/** Natural sort so "- 2.jpg" sorts before "- 10.jpg"; position 1 is primary. */
function byImageOrder(a, b) {
  const na = Number(a.match(/(\d+)(?=\.\w+$)/)?.[1] ?? 0);
  const nb = Number(b.match(/(\d+)(?=\.\w+$)/)?.[1] ?? 0);
  return na !== nb ? na - nb : a.localeCompare(b);
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);
  const images = new ImageStore({ pool, publicUrl: config.publicUrl });

  const [rows] = await pool.query(
    `SELECT p.id, p.sku, p.name, p.brand, c.slug AS category_slug
     FROM products p JOIN categories c ON c.id = p.category_id
     ORDER BY c.slug, p.name`
  );
  const products = rows.map((p) => ({
    ...p,
    folderName: safeName(p.brand ? `${p.brand} ${p.name}` : p.name),
  }));

  if (args.list) {
    console.log(`Create these folders under ${config.imagesRoot}:\n`);
    let current = "";
    for (const p of products) {
      if (p.category_slug !== current) {
        current = p.category_slug;
        console.log(`${current}/`);
      }
      console.log(`  ${current}/${p.folderName}/`);
    }
    console.log(`\nEach folder holds "${"<name>"} - 1.jpg", "- 2.jpg", … (any of .jpg/.jpeg/.png/.webp). Position 1 is the main photo.`);
    await pool.end();
    return;
  }

  const stats = { imported: 0, skippedHasPhotos: 0, skippedNoFolder: 0, skippedEmpty: 0, warnings: 0 };

  for (const p of products) {
    const dir = path.join(config.imagesRoot, p.category_slug, p.folderName);
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch {
      stats.skippedNoFolder++;
      continue;
    }

    const files = entries.filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase())).sort(byImageOrder);
    if (files.length === 0) {
      console.warn(`  ! ${p.folderName}: folder exists but has no .jpg/.png/.webp files`);
      stats.skippedEmpty++;
      continue;
    }

    const [[{ n: existing }]] = await pool.query("SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?", [p.id]);
    if (existing > 0 && !args.replace) {
      stats.skippedHasPhotos++;
      continue;
    }

    if (args["dry-run"]) {
      console.log(`  ${existing > 0 ? "replace" : "import"}  ${p.sku.padEnd(24)} ${files.length} photo(s)  ${p.folderName}`);
      stats.imported++;
      continue;
    }

    const items = [];
    for (const file of files) {
      const buffer = await fs.readFile(path.join(dir, file));
      const type = detectImageType(buffer);
      if (!type) {
        console.warn(`  ! ${p.folderName}/${file}: not a real JPEG/PNG/WebP — skipped`);
        stats.warnings++;
        continue;
      }
      items.push({ buffer, mime: type.mime, name: file });
    }
    if (items.length === 0) continue;

    if (existing > 0 && args.replace) {
      await pool.query("DELETE FROM product_images WHERE product_id = ?", [p.id]);
    }
    await images.add(p.id, items);
    stats.imported++;
  }

  console.log(
    `\n${args["dry-run"] ? "[dry run] " : ""}imported: ${stats.imported}  already had photos: ${stats.skippedHasPhotos}  no folder found: ${stats.skippedNoFolder}  empty folder: ${stats.skippedEmpty}  warnings: ${stats.warnings}`
  );
  if (stats.skippedNoFolder > 0) {
    console.log(`Run with --list to print the exact folder names the remaining products expect.`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
