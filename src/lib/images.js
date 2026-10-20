/**
 * Image helpers. Photos are stored in the database (see imageStore.js) — there
 * is no on-disk photo library for this project; all photos come in through the
 * admin's upload UI.
 */

export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
export const MAX_IMAGES_PER_PRODUCT = 30;

/** Detects the real image type from magic bytes (never trusts the client's MIME type). */
export function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: ".png", mime: "image/png" };
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { ext: ".webp", mime: "image/webp" };
  }
  return null;
}
