import { Router } from "express";
import multer from "multer";
import { HttpError, invalid, parse } from "../errors.js";
import { detectImageType, MAX_IMAGES_PER_PRODUCT } from "../lib/images.js";
import { idParam, reorderSchema } from "../schemas.js";
import { getProductRow } from "../services/products.js";

const MAX_FILES_PER_REQUEST = 10;

/** Product photo management. Photos are stored in MariaDB; `file` in responses is the image id. */
export function adminImagesRouter({ pool, images, config }) {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: MAX_FILES_PER_REQUEST, fields: 5 },
  });

  const payload = async (id) => ({ max: MAX_IMAGES_PER_PRODUCT, images: await images.list(id) });

  r.get("/products/:id/images", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await getProductRow(pool, id);
    res.json(await payload(id));
  });

  // multipart/form-data: `images` (1-10 files: jpg/png/webp)
  r.post("/products/:id/images", upload.array("images", MAX_FILES_PER_REQUEST), async (req, res) => {
    const { id } = parse(idParam, req.params);
    await getProductRow(pool, id);
    const files = req.files ?? [];
    if (!files.length) throw invalid("No images uploaded", [{ path: "images", message: "Attach at least one file" }]);

    // Verify every file (real type from magic bytes) before storing any of them.
    const items = files.map((f, i) => {
      const type = detectImageType(f.buffer);
      if (!type) throw new HttpError(415, "UNSUPPORTED_MEDIA", `File ${i + 1} is not a JPEG, PNG or WebP image`);
      return { buffer: f.buffer, mime: type.mime, name: f.originalname };
    });

    const created = await images.add(id, items);
    res.status(201).json({ created, ...(await payload(id)) });
  });

  // body { files: [<every current image id, in the new order>] } — the first becomes the primary image.
  r.put("/products/:id/images/order", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { files } = parse(reorderSchema, req.body);
    await getProductRow(pool, id);
    await images.reorder(id, files);
    res.json(await payload(id));
  });

  r.delete("/products/:id/images/:file", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await getProductRow(pool, id);
    await images.remove(id, req.params.file);
    res.json(await payload(id));
  });

  // Homepage banner picture: multipart `image` (jpg/png/webp) → { url } to put in the banner's `image`.
  r.post("/banners/image", upload.single("image"), async (req, res) => {
    if (!req.file) throw invalid("No image uploaded", [{ path: "image", message: "Attach a file" }]);
    const type = detectImageType(req.file.buffer);
    if (!type) throw new HttpError(415, "UNSUPPORTED_MEDIA", "Not a JPEG, PNG or WebP image");
    res.status(201).json({ url: await images.addBannerImage({ buffer: req.file.buffer, mime: type.mime }) });
  });

  return r;
}
