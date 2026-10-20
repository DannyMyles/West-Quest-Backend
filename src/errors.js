import { ZodError } from "zod";

/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = "Bad request", details) => new HttpError(400, "BAD_REQUEST", message, details);
export const unauthenticated = (message = "Authentication required") => new HttpError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "Forbidden") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message, details, code = "CONFLICT") => new HttpError(409, code, message, details);
export const invalid = (message = "Invalid request", details) => new HttpError(422, "VALIDATION_ERROR", message, details);

/** Parse `data` with a zod schema, throwing a 422 with per-field details. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw invalid("Invalid request", zodDetails(result.error));
}

function zodDetails(error) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Maps MariaDB duplicate-key errors to a 409 naming the offending field. */
const DUP_FIELDS = {
  uq_products_sku: "sku",
  uq_products_slug: "slug",
  uq_categories_slug: "slug",
  uq_admins_email: "email",
  uq_applications_ref: "ref",
  uq_payment_plans_product_tier: "tier",
};
export function rethrowDuplicate(err, fallbackMessage = "Duplicate value") {
  if (err?.code === "ER_DUP_ENTRY" || err?.errno === 1062) {
    const key = /for key '([^']+)'/.exec(err.sqlMessage ?? "")?.[1]?.split(".").pop();
    const field = DUP_FIELDS[key];
    throw conflict(
      field ? `A record with this ${field} already exists` : fallbackMessage,
      field ? { field } : undefined,
      "DUPLICATE"
    );
  }
  throw err;
}

export function notFoundHandler(req, _res, next) {
  next(notFound("Route"));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    err = invalid("Invalid request", zodDetails(err));
  } else if (err?.type === "entity.too.large") {
    err = new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  } else if (err?.type === "entity.parse.failed") {
    err = badRequest("Malformed JSON body");
  } else if (err?.name === "MulterError") {
    err =
      err.code === "LIMIT_FILE_SIZE"
        ? new HttpError(413, "PAYLOAD_TOO_LARGE", "Image is too large")
        : badRequest(`Upload error: ${err.message}`);
  }

  // Framework-raised client errors (e.g. a URL with broken %-encoding) carry a
  // 4xx status — pass those through as a generic 400-class response, not a 500.
  const status = err?.status ?? err?.statusCode;
  if (!(err instanceof HttpError) && Number.isInteger(status) && status >= 400 && status < 500) {
    err = new HttpError(status, "BAD_REQUEST", "Bad request");
  }

  if (err instanceof HttpError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  // Unknown failure: log the detail, never leak it to the client.
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
}
