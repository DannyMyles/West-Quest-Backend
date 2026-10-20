import cors from "cors";
import rateLimit from "express-rate-limit";
import { HttpError, forbidden } from "../errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Set of browser origins allowed to call this API (frontend origins + our own). */
export function allowedOrigins(config) {
  return new Set([...config.corsOrigins, new URL(config.publicUrl).origin]);
}

export function corsMiddleware(config) {
  const allowed = allowedOrigins(config);
  return cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 600,
  });
}

/**
 * CSRF defence for cookie auth: a state-changing request that carries an
 * Origin header must come from an allowed origin. (Requests with no Origin —
 * curl, server-to-server — can't be forged by a victim's browser.)
 */
export function originGuard(config) {
  const allowed = allowedOrigins(config);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin && !allowed.has(origin)) return next(forbidden("Origin not allowed"));
    next();
  };
}

const tooMany = (_req, _res, next) =>
  next(new HttpError(429, "RATE_LIMITED", "Too many attempts. Please try again later."));

/** Brute-force protection: only *failed* logins count against the budget. */
export const loginLimiter = (limit = 10) =>
  rateLimit({ windowMs: 15 * 60 * 1000, limit, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false, handler: tooMany });

export const apiLimiter = (limit = 600) =>
  rateLimit({ windowMs: 60 * 1000, limit, standardHeaders: "draft-8", legacyHeaders: false, handler: tooMany });

/** Generic per-IP limiter for public write endpoints (applications, tracking, reviews). */
export const limiter = (windowMs, limit) =>
  rateLimit({ windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false, handler: tooMany });
