import { Router } from "express";
import { parse } from "../errors.js";
import { limiter } from "../middleware/security.js";
import { reviewCreateSchema, reviewListQuerySchema } from "../schemas.js";
import { createReview, listApprovedReviews } from "../services/reviews.js";

const HOUR = 60 * 60 * 1000;

/** Public review endpoints: the approved list and new submissions.
 *  (Applications and orders are placed through /api/account/checkout.) */
export function publicReviewsRouter({ pool }, options = {}) {
  const r = Router();

  r.get("/reviews", async (req, res) => {
    const { sku } = parse(reviewListQuerySchema, req.query);
    res.json({ items: await listApprovedReviews(pool, sku) });
  });

  r.post("/reviews", limiter(HOUR, options.reviewLimit ?? 10), async (req, res) => {
    await createReview(pool, parse(reviewCreateSchema, req.body));
    res.status(201).json({ ok: true, message: "Thanks! Your review will appear once it's approved." });
  });

  return r;
}
