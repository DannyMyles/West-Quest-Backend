import { z } from "zod";

export const BADGES = ["New", "Best Seller", "Popular", "Limited"];
export const SORTS = ["featured", "rrp-asc", "rrp-desc", "name", "newest", "discount"];
export const TIERS = ["retail", "vip"];
export const TERMS = [6, 9, 12];
export const APPLICATION_STATUSES = ["pending", "contacted", "approved", "rejected"];

const slug = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens");

const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const flag = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9 +()-]+$/, "Digits, spaces, + ( ) - only")
  .refine((v) => {
    const digits = v.replace(/\D/g, "").length;
    return digits >= 9 && digits <= 15;
  }, "Enter a valid phone number");

// --- products ---------------------------------------------------------
// Note: no `.default()` anywhere — the update schema is `.partial()` of the
// create schema and defaults would silently overwrite fields on PATCH. Defaults
// are applied explicitly in the service when inserting.
export const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sku: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Letters, numbers and . _ / - only"),
  category: slug(64), // category slug
  slug: slug(190).optional(), // defaults to slugify(`${name}-${sku}`)
  brand: optionalText(80),
  modelCode: optionalText(40),
  ram: optionalText(20),
  storage: optionalText(20),
  rrp: z.number().int().min(0).max(100_000_000),
  // Optional "was" price: the product is on offer while this is above `rrp`.
  wasPrice: z.number().int().min(0).max(100_000_000).nullable().optional(),
  offerEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  description: z.string().max(10_000).optional(),
  specs: z
    .array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(300) }))
    .max(60)
    .optional(),
  inStock: z.boolean().optional(),
  stockCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  badge: z.enum(BADGES).nullable().optional(),
  // Display-only fallbacks shown until approved customer reviews exist.
  rating: z.number().min(0).max(5).multipleOf(0.1).nullable().optional(),
  reviewCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  featured: z.boolean().optional(),
  featureRank: z.number().int().min(0).max(100_000).nullable().optional(),
  active: z.boolean().optional(),
  adminNotes: optionalText(2000),
});

export const productUpdateSchema = productCreateSchema.omit({ slug: true }).partial();

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(64).optional(),
  brand: z.string().trim().max(80).optional(),
  ram: z.string().trim().max(20).optional(),
  storage: z.string().trim().max(20).optional(),
  minRrp: z.coerce.number().int().min(0).optional(),
  maxRrp: z.coerce.number().int().min(0).optional(),
  inStock: flag.optional(),
  featured: flag.optional(),
  onOffer: flag.optional(),
  active: flag.optional(), // admin list only
  sort: z.enum(SORTS).default("featured"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// --- payment plans ------------------------------------------------------
export const paymentPlanSchema = z.object({
  depositPercent: z.number().min(0).max(100),
  depositAmount: z.number().int().min(0),
  daily6: z.number().int().min(0),
  daily9: z.number().int().min(0),
  daily12: z.number().int().min(0),
});
export const tierParam = z.object({ tier: z.enum(TIERS) });

// --- categories -------------------------------------------------------
export const categoryCreateSchema = z.object({
  slug: slug(64),
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
  active: z.boolean().optional(),
});
export const categoryUpdateSchema = categoryCreateSchema.omit({ slug: true }).partial();
export const categoryDeleteQuerySchema = z.object({ reassignTo: slug(64).optional() });

// --- auth -------------------------------------------------------------
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(190).pipe(z.email()),
  password: z.string().min(1).max(200),
});

export const PASSWORD_MIN = 10;
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(200);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordSchema,
});

// --- images -----------------------------------------------------------
export const reorderSchema = z.object({ files: z.array(z.string().min(1).max(300)).min(1).max(100) });

export const idParam = z.object({ id: z.coerce.number().int().min(1) });

// --- applications -----------------------------------------------------------
export const applicationListQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const applicationUpdateSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    adminNotes: optionalText(2000),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

// --- customer accounts + checkout -------------------------------------------
export const ORDER_STATUSES = ["pending", "confirmed", "completed", "cancelled"];
export const CUSTOMER_PASSWORD_MIN = 8;

export const customerRegisterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone,
  password: z.string().min(CUSTOMER_PASSWORD_MIN, `Password must be at least ${CUSTOMER_PASSWORD_MIN} characters`).max(200),
});

export const customerLoginSchema = z.object({
  phone,
  password: z.string().min(1).max(200),
});

const checkoutItem = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("plan"),
    productSlug: slug(190),
    tier: z.enum(TIERS),
    termMonths: z.union([z.literal(6), z.literal(9), z.literal(12)]),
  }),
  z.object({
    mode: z.literal("cash"),
    productSlug: slug(190),
    quantity: z.number().int().min(1).max(20),
  }),
]);

export const checkoutSchema = z.object({
  items: z.array(checkoutItem).min(1, "Your cart is empty").max(20),
  location: z.string().trim().min(2, "Tell us where you are").max(190),
  idNumber: z.string().trim().max(20).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const orderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const orderUpdateSchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    adminNotes: optionalText(2000),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

// --- reviews ----------------------------------------------------------------
export const reviewCreateSchema = z.object({
  productSku: z.string().trim().min(1).max(80),
  customerName: z.string().trim().min(1).max(80),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(2000),
});
export const reviewListQuerySchema = z.object({ sku: z.string().trim().min(1).max(80) });
export const adminReviewListQuerySchema = z.object({
  approved: flag.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const reviewUpdateSchema = z.object({ approved: z.boolean() });

// --- banners ----------------------------------------------------------------
// Only http(s) URLs or site-relative paths: blocks javascript:/data: URLs in links & <img>.
const safeUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => /^https?:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//")), "Must be an http(s) URL or a path starting with /");

export const bannerCreateSchema = z.object({
  eyebrow: z.string().trim().max(120).nullish(),
  headline: z.string().trim().min(1).max(200),
  subcopy: z.string().trim().max(400).nullish(),
  image: safeUrl,
  layout: z.enum(["photo", "product"]).optional(),
  accent: z.string().trim().regex(/^#[0-9a-f]{6}$/i, "Must be a colour like #3c2a6b").nullish().or(z.literal("")),
  badge: z.string().trim().max(40).nullish(),
  ctaLabel: z.string().trim().max(60).nullish(),
  ctaHref: safeUrl.nullish().or(z.literal("")),
  cta2Label: z.string().trim().max(60).nullish(),
  cta2Href: safeUrl.nullish().or(z.literal("")),
  dealEndsAt: z.iso.datetime({ offset: true }).nullish(),
  active: z.boolean().optional(),
});
export const bannerUpdateSchema = bannerCreateSchema.partial();
export const bannerOrderSchema = z.object({ ids: z.array(z.number().int().min(1)).min(1).max(200) });

// --- bulk product import ------------------------------------------------------
export const bulkProductsSchema = z.object({ items: z.array(z.unknown()).min(1).max(500) });

// --- admin users ---------------------------------------------------------------
export const adminCreateSchema = z.object({
  email: z.string().trim().toLowerCase().max(190).pipe(z.email()),
  name: z.string().trim().min(1).max(120),
  password: newPasswordSchema,
});
export const adminUpdateSchema = z
  .object({ active: z.boolean().optional(), password: newPasswordSchema.optional(), name: z.string().trim().min(1).max(120).optional() })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field");
