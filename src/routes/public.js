import { Router } from "express";
import { notFound, parse } from "../errors.js";
import { listQuerySchema } from "../schemas.js";
import { getProductBySlug, listProducts } from "../services/products.js";
import { listCategories } from "../services/categories.js";
import { listBanners } from "../services/banners.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Read-only storefront API: only active products in active categories. */
export function publicRouter(ctx) {
  const r = Router();

  r.get("/health", async (_req, res) => {
    await ctx.pool.query("SELECT 1");
    res.json({ status: "ok", db: "up" });
  });

  r.get("/products", async (req, res) => {
    const filters = parse(listQuerySchema, req.query);
    res.json(await listProducts(ctx, filters, { publicOnly: true }));
  });

  r.get("/products/:slug", async (req, res) => {
    if (!SLUG_RE.test(req.params.slug)) throw notFound("Product");
    res.json(await getProductBySlug(ctx, req.params.slug, { publicOnly: true }));
  });

  r.get("/categories", async (_req, res) => {
    res.json({ items: await listCategories(ctx.pool, { admin: false, images: ctx.images }) });
  });

  r.get("/banners", async (_req, res) => {
    res.json({ items: await listBanners(ctx.pool, { activeOnly: true }) });
  });

  return r;
}
