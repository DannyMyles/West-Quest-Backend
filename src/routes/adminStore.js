import { Router } from "express";
import { parse } from "../errors.js";
import {
  adminReviewListQuerySchema,
  bannerCreateSchema,
  bannerOrderSchema,
  bannerUpdateSchema,
  idParam,
  reviewUpdateSchema,
} from "../schemas.js";
import { deleteReview, listReviewsAdmin, setReviewApproved } from "../services/reviews.js";
import { createBanner, deleteBanner, listBanners, reorderBanners, updateBanner } from "../services/banners.js";
import { getStats } from "../services/stats.js";

/** Reviews moderation, banners and the overview numbers. */
export function adminStoreRouter({ pool }) {
  const r = Router();

  r.get("/stats", async (_req, res) => res.json(await getStats(pool)));

  // --- reviews
  r.get("/reviews", async (req, res) => res.json(await listReviewsAdmin(pool, parse(adminReviewListQuerySchema, req.query))));
  r.patch("/reviews/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await setReviewApproved(pool, id, parse(reviewUpdateSchema, req.body).approved);
    res.status(204).end();
  });
  r.delete("/reviews/:id", async (req, res) => {
    await deleteReview(pool, parse(idParam, req.params).id);
    res.status(204).end();
  });

  // --- banners
  r.get("/banners", async (_req, res) => res.json({ items: await listBanners(pool, { activeOnly: false }) }));
  r.post("/banners", async (req, res) => {
    const banner = await createBanner(pool, parse(bannerCreateSchema, req.body));
    res.status(201).location(`/api/admin/banners/${banner.id}`).json(banner);
  });
  r.put("/banners/order", async (req, res) => {
    res.json({ items: await reorderBanners(pool, parse(bannerOrderSchema, req.body).ids) });
  });
  r.patch("/banners/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await updateBanner(pool, id, parse(bannerUpdateSchema, req.body)));
  });
  r.delete("/banners/:id", async (req, res) => {
    await deleteBanner(pool, parse(idParam, req.params).id);
    res.status(204).end();
  });

  return r;
}
