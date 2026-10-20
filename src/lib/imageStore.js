import { conflict, invalid, notFound } from "../errors.js";
import { withTransaction } from "../db.js";
import { MAX_IMAGES_PER_PRODUCT } from "./images.js";

/**
 * Product photos stored in MariaDB (`product_images`, LONGBLOB).
 *
 * Listings never read the blob column — only metadata — so product lists stay
 * cheap. Bytes are read one image at a time by `GET /images/p/:id`. Position 1
 * is the primary photo; positions are kept compact (1..n).
 */
export class ImageStore {
  constructor({ pool, publicUrl }) {
    this.pool = pool;
    this.publicUrl = publicUrl;
  }

  url(id, updatedAt) {
    return `${this.publicUrl}/images/p/${id}?v=${new Date(updatedAt).getTime()}`;
  }

  /** Homepage-banner pictures (uploaded from the admin), served at /images/b/:id. */
  async addBannerImage({ buffer, mime }) {
    const [r] = await this.pool.query("INSERT INTO banner_images (mime, size, data) VALUES (?, ?, ?)", [mime, buffer.length, buffer]);
    return `${this.publicUrl}/images/b/${r.insertId}`;
  }

  async getBannerImage(id) {
    const [rows] = await this.pool.query("SELECT mime, data FROM banner_images WHERE id = ?", [id]);
    return rows[0] ?? null;
  }

  /** `file` is the image id as a string — stable across reorders, used by the admin API. */
  _shape(row) {
    return { file: String(row.id), position: row.position, size: row.size, url: this.url(row.id, row.updated_at) };
  }

  /** Image metadata for many products in one query → Map(productId → [image…]) in display order. */
  async listForProducts(productIds) {
    const map = new Map(productIds.map((id) => [id, []]));
    if (!productIds.length) return map;
    const [rows] = await this.pool.query(
      "SELECT id, product_id, position, size, updated_at FROM product_images WHERE product_id IN (?) ORDER BY product_id, position, id",
      [productIds]
    );
    for (const r of rows) map.get(r.product_id).push(this._shape(r));
    return map;
  }

  async list(productId) {
    return (await this.listForProducts([productId])).get(productId);
  }

  /** Bytes for serving; null when there is no such image. */
  async getData(id) {
    const [rows] = await this.pool.query("SELECT mime, data, updated_at FROM product_images WHERE id = ?", [id]);
    return rows[0] ?? null;
  }

  /** Append verified images (`{ buffer, mime, name }`) to the end of the product's gallery. */
  async add(productId, items) {
    return withTransaction(this.pool, async (conn) => {
      // Lock the product row so parallel uploads/reorders for it run one at a time.
      const [locked] = await conn.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
      if (!locked.length) throw notFound("Product");
      const [[{ n, max }]] = await conn.query(
        "SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS max FROM product_images WHERE product_id = ?",
        [productId]
      );
      if (n + items.length > MAX_IMAGES_PER_PRODUCT) {
        throw conflict(
          `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images (currently ${n})`,
          undefined,
          "TOO_MANY_IMAGES"
        );
      }
      const created = [];
      let position = max;
      for (const { buffer, mime, name } of items) {
        position += 1;
        const [r] = await conn.query(
          "INSERT INTO product_images (product_id, position, file_name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)",
          [productId, position, String(name ?? "image").slice(0, 255), mime, buffer.length, buffer]
        );
        created.push(String(r.insertId));
      }
      return created;
    });
  }

  /** `files` must be every current image id exactly once; that order becomes 1..n. */
  async reorder(productId, files) {
    return withTransaction(this.pool, async (conn) => {
      await conn.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
      const [rows] = await conn.query("SELECT id FROM product_images WHERE product_id = ?", [productId]);
      const existing = rows.map((r) => String(r.id));
      const wanted = new Set(files);
      if (files.length !== existing.length || wanted.size !== files.length || !existing.every((f) => wanted.has(f))) {
        throw invalid("`files` must list every current image exactly once", [
          { path: "files", message: `Current images: ${existing.join(", ") || "(none)"}` },
        ]);
      }
      for (const [i, id] of files.entries()) {
        await conn.query("UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?", [i + 1, Number(id), productId]);
      }
    });
  }

  async remove(productId, file) {
    if (!/^\d+$/.test(file)) throw notFound("Image");
    await withTransaction(this.pool, async (conn) => {
      await conn.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
      const [r] = await conn.query("DELETE FROM product_images WHERE id = ? AND product_id = ?", [Number(file), productId]);
      if (r.affectedRows === 0) throw notFound("Image");
      // Close the gap so positions stay 1..n.
      const [rest] = await conn.query("SELECT id FROM product_images WHERE product_id = ? ORDER BY position, id", [productId]);
      for (const [i, row] of rest.entries()) {
        await conn.query("UPDATE product_images SET position = ? WHERE id = ?", [i + 1, row.id]);
      }
    });
  }
}
