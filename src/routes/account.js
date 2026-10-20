import { Router } from "express";
import { HttpError, parse, unauthenticated } from "../errors.js";
import { checkoutSchema, customerLoginSchema, customerRegisterSchema } from "../schemas.js";
import {
  authenticateCustomer,
  createCustomerSession,
  destroyCustomerSession,
  findCustomerSession,
  registerCustomer,
} from "../services/customers.js";
import { checkout, customerActivity } from "../services/orders.js";
import { getApplication } from "../services/applications.js";
import { limiter, loginLimiter, originGuard } from "../middleware/security.js";

const HOUR = 60 * 60 * 1000;

/** Customer accounts (phone + password) and checkout, under /api/account. */
export function accountRouter(ctx, options = {}) {
  const { pool, config, notifier } = ctx;
  const { customerCookieName: cookieName, customerTtlHours: ttlHours, cookieSecure, cookieSameSite } = config.session;
  const cookie = (withMaxAge = true) => ({
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: "/api/account", // only ever sent to account endpoints
    ...(withMaxAge ? { maxAge: ttlHours * 3600 * 1000 } : {}),
  });

  async function signIn(req, res, customer) {
    const token = await createCustomerSession(pool, customer.id, { ip: req.ip, userAgent: req.get("user-agent"), ttlHours });
    res.cookie(cookieName, token, cookie());
  }

  const requireCustomer = async (req, res, next) => {
    const token = req.cookies?.[cookieName];
    const customer = token ? await findCustomerSession(pool, token) : null;
    if (!customer) {
      if (token) res.clearCookie(cookieName, cookie(false));
      return next(unauthenticated("Please sign in to continue"));
    }
    req.customer = customer;
    next();
  };

  const r = Router();
  r.use(originGuard(config));

  r.post("/register", limiter(HOUR, options.registerLimit ?? 10), async (req, res) => {
    const input = parse(customerRegisterSchema, req.body);
    const customer = await registerCustomer(pool, input);
    await signIn(req, res, customer);
    res.status(201).json({ customer });
  });

  r.post("/login", loginLimiter(options.loginAttempts ?? 10), async (req, res) => {
    const { phone, password } = parse(customerLoginSchema, req.body);
    const customer = await authenticateCustomer(pool, phone, password);
    if (!customer) throw new HttpError(401, "INVALID_CREDENTIALS", "Wrong phone number or password");
    await signIn(req, res, customer);
    res.json({ customer });
  });

  r.post("/logout", async (req, res) => {
    const token = req.cookies?.[cookieName];
    if (token) await destroyCustomerSession(pool, token);
    res.clearCookie(cookieName, cookie(false));
    res.status(204).end();
  });

  // 200 with null rather than 401, so the storefront can check quietly.
  r.get("/me", async (req, res) => {
    const token = req.cookies?.[cookieName];
    res.json({ customer: token ? await findCustomerSession(pool, token) : null });
  });

  r.get("/activity", requireCustomer, async (req, res) => {
    res.json(await customerActivity(pool, req.customer.id));
  });

  r.post("/checkout", requireCustomer, limiter(HOUR, options.checkoutLimit ?? 30), async (req, res) => {
    const result = await checkout(ctx, req.customer, parse(checkoutSchema, req.body));
    if (notifier?.enabled) {
      for (const a of result.applications) {
        const full = await getApplication(pool, a.id).catch(() => null);
        if (full) notifier.applicationSubmitted(full);
      }
      if (result.order) notifier.orderPlaced(result.order);
    }
    res.status(201).json(result);
  });

  return r;
}
