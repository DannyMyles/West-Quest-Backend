import { Router } from "express";
import { parse } from "../errors.js";
import {
  categoryCreateSchema,
  categoryDeleteQuerySchema,
  categoryUpdateSchema,
  idParam,
} from "../schemas.js";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from "../services/categories.js";

export function adminCategoriesRouter({ pool }) {
  const r = Router();

  r.get("/categories", async (_req, res) => {
    res.json({ items: await listCategories(pool, { admin: true }) });
  });

  r.get("/categories/:id", async (req, res) => {
    res.json(await getCategory(pool, parse(idParam, req.params).id));
  });

  r.post("/categories", async (req, res) => {
    const category = await createCategory(pool, parse(categoryCreateSchema, req.body));
    res.status(201).location(`/api/admin/categories/${category.id}`).json(category);
  });

  r.patch("/categories/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await updateCategory(pool, id, parse(categoryUpdateSchema, req.body)));
  });

  r.delete("/categories/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { reassignTo } = parse(categoryDeleteQuerySchema, req.query);
    await deleteCategory(pool, id, reassignTo);
    res.status(204).end();
  });

  return r;
}
