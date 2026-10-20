import { Router } from "express";
import { parse } from "../errors.js";
import {
  bulkProductsSchema,
  idParam,
  listQuerySchema,
  paymentPlanSchema,
  productCreateSchema,
  productUpdateSchema,
  tierParam,
} from "../schemas.js";
import {
  bulkUpsertProducts,
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  updateProduct,
} from "../services/products.js";
import { removePlan, upsertPlan } from "../services/paymentPlans.js";

export function adminProductsRouter(ctx) {
  const r = Router();

  r.get("/products", async (req, res) => {
    res.json(await listProducts(ctx, parse(listQuerySchema, req.query), { publicOnly: false }));
  });

  r.get("/products/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getProductById(ctx, id));
  });

  r.post("/products", async (req, res) => {
    const product = await createProduct(ctx, parse(productCreateSchema, req.body));
    res.status(201).location(`/api/admin/products/${product.id}`).json(product);
  });

  // Bulk create-or-update by SKU (used by CSV import / catalogue import): { items: [...] }
  r.post("/products/bulk", async (req, res) => {
    const { items } = parse(bulkProductsSchema, req.body);
    res.json(await bulkUpsertProducts(ctx, items));
  });

  // Partial update — this is also how RRP/specs/stock are changed.
  r.patch("/products/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await updateProduct(ctx, id, parse(productUpdateSchema, req.body)));
  });

  r.delete("/products/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteProduct(ctx, id);
    res.status(204).end();
  });

  // Set (create or replace) a product's retail/vip financing plan.
  r.put("/products/:id/plans/:tier", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { tier } = parse(tierParam, req.params);
    res.json({ paymentPlans: await upsertPlan(ctx, id, tier, parse(paymentPlanSchema, req.body)) });
  });

  // Remove a tier (e.g. stop offering VIP for this product).
  r.delete("/products/:id/plans/:tier", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { tier } = parse(tierParam, req.params);
    res.json({ paymentPlans: await removePlan(ctx, id, tier) });
  });

  return r;
}
