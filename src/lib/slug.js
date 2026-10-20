/** Same rules as the storefront's `slugify()` (src/lib/format.ts). */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Folder/file-safe name — keeps the text human-readable (unlike slugify),
 *  just strips characters that break on common filesystems. Used to build
 *  the expected local image-folder name for a product. */
export function safeName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
