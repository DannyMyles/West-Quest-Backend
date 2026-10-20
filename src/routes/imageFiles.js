import { Router } from "express";
import { notFound } from "../errors.js";

/** Serves a stored photo: GET /images/p/:id  (the `?v=` in our URLs changes when the image does). */
export function imageFilesRouter({ images }) {
  const r = Router();

  r.get("/p/:id", async (req, res) => {
    if (!/^\d{1,10}$/.test(req.params.id)) throw notFound("Image");
    const img = await images.getData(Number(req.params.id));
    if (!img) throw notFound("Image");

    const versioned = typeof req.query.v === "string" && /^\d+$/.test(req.query.v);
    res.set("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Type", img.mime);
    res.send(img.data);
  });

  // Banner pictures never change once uploaded (a new upload gets a new id), so cache hard.
  r.get("/b/:id", async (req, res) => {
    if (!/^\d{1,10}$/.test(req.params.id)) throw notFound("Image");
    const img = await images.getBannerImage(Number(req.params.id));
    if (!img) throw notFound("Image");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Type", img.mime);
    res.send(img.data);
  });

  return r;
}
