import { unauthenticated } from "../errors.js";
import { findSession } from "../services/auth.js";

export function cookieOptions(config, { withMaxAge = true } = {}) {
  const { session } = config;
  return {
    httpOnly: true,
    secure: session.cookieSecure,
    sameSite: session.cookieSameSite,
    path: "/api/admin", // the cookie is only ever sent to admin endpoints
    ...(withMaxAge ? { maxAge: Math.round(session.ttlHours * 3600 * 1000) } : {}),
  };
}

/** Requires a live admin session cookie; sets req.admin / req.sessionToken. */
export function requireAdmin({ pool, config }) {
  return async (req, res, next) => {
    const token = req.cookies?.[config.session.cookieName];
    if (!token) return next(unauthenticated());
    const admin = await findSession(pool, token);
    if (!admin) {
      res.clearCookie(config.session.cookieName, cookieOptions(config, { withMaxAge: false }));
      return next(unauthenticated("Session expired — please sign in again"));
    }
    req.admin = { id: admin.id, email: admin.email, name: admin.name };
    req.sessionToken = token;
    next();
  };
}
