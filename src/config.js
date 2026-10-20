import os from "node:os";
import path from "node:path";
import { z } from "zod";

const bool = (dflt) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? dflt : v === "true" || v === "1"));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().default("westquest"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("westquest"),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  // Only read by `scripts/import-images.js`, to load product photos you've
  // placed in a local folder (never written to or fetched from automatically).
  IMAGES_ROOT: z.string().optional(),
  PUBLIC_URL: z.url().optional(),
  MAX_UPLOAD_MB: z.coerce.number().min(0.1).max(50).default(6),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_TTL_HOURS: z.coerce.number().min(0.25).max(24 * 30).default(12),
  COOKIE_SECURE: bool(undefined),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  TRUST_PROXY: z.string().optional(),

  // New-application email alerts (all optional — with no SMTP_HOST / NOTIFY_EMAIL_TO nothing is sent).
  NOTIFY_EMAIL_TO: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  STORE_NAME: z.string().default("West Quest Limited"),
});

/** Parses `mysql://user:pass@host:3306/db` into discrete pieces. */
function parseDatabaseUrl(url) {
  const u = new URL(url);
  if (!/^(mysql|mariadb):$/.test(u.protocol)) {
    throw new Error("DATABASE_URL must start with mysql:// or mariadb://");
  }
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === "production";

  const db = e.DATABASE_URL
    ? { ...parseDatabaseUrl(e.DATABASE_URL), poolSize: e.DB_POOL_SIZE }
    : {
        host: e.DB_HOST,
        port: e.DB_PORT,
        user: e.DB_USER,
        password: e.DB_PASSWORD,
        database: e.DB_NAME,
        poolSize: e.DB_POOL_SIZE,
      };

  const cookieSecure = e.COOKIE_SECURE ?? isProd;
  if (e.COOKIE_SAMESITE === "none" && !cookieSecure) {
    throw new Error("COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
  }

  let trustProxy = false;
  if (e.TRUST_PROXY !== undefined) {
    trustProxy = /^\d+$/.test(e.TRUST_PROXY) ? Number(e.TRUST_PROXY) : e.TRUST_PROXY === "true";
  }

  return {
    env: e.NODE_ENV,
    isProd,
    host: e.HOST,
    port: e.PORT,
    db,
    imagesRoot: path.resolve(e.IMAGES_ROOT ?? path.join(os.homedir(), "Desktop", "programming", "west-quest-images")),
    publicUrl: (e.PUBLIC_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, ""),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
    session: {
      ttlHours: e.SESSION_TTL_HOURS,
      cookieName: "wq_admin_session",
      customerCookieName: "wq_customer_session",
      customerTtlHours: 24 * 30,
      cookieSecure,
      cookieSameSite: e.COOKIE_SAMESITE,
    },
    trustProxy,
    notify: {
      to: (e.NOTIFY_EMAIL_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      smtp: e.SMTP_HOST
        ? {
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            secure: e.SMTP_SECURE ?? e.SMTP_PORT === 465,
            auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? "" } : undefined,
          }
        : null,
      from: e.SMTP_FROM ?? e.SMTP_USER ?? `applications@${e.SMTP_HOST ?? "localhost"}`,
      storeName: e.STORE_NAME,
    },
  };
}
