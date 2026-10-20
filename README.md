# West Quest backend (Node.js + MariaDB)

The API behind the West Quest storefront and admin dashboard: admin and
customer sign-in, products (with special offers), payment plans (deposit +
daily rate per tier/term), categories, product photos, checkout (financing
applications + cash orders), reviews and homepage banners — plus the read
endpoints the storefront needs.

The storefront is a separate project (`West-Quest`, Next.js). It reaches this
API through its `BACKEND_URL`; add the storefront's origin to `CORS_ORIGINS`
here.

* **Node 22.9+**, Express 5, `mysql2`, `zod` (validation), `bcryptjs`, `helmet`, `cors`, `multer`
* **MariaDB 10.5+**
* **Product photos live in the database** — uploaded through the admin, nothing on disk

```
West-Quest-backend/
  db/migrations/           idempotent SQL migrations, run in order
  data/                    categories.json + catalogue.json for the first import
  scripts/                 migrate · create-admin · import-catalog · import-images
  src/                     app, config, routes/, services/, middleware/, lib/
  test/                    integration tests (node:test) against a real MariaDB
```

## Quick start

```bash
cd West-Quest-backend
npm install
cp .env.example .env            # then edit DB_* / CORS_ORIGINS
```

Create the database and a least-privilege user once (as the MariaDB admin):

```sql
CREATE DATABASE westquest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'westquest'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON westquest.* TO 'westquest'@'localhost';
```

```bash
npm run migrate                       # creates the tables (safe to re-run)
npm run create-admin -- --email you@example.com --name "Your Name"
                                       # prints a generated password once, or pass --password '…' (min 10 chars)
npm run import-catalog -- --dry-run   # preview: 2 categories + 51 products with payment plans
npm run import-catalog                # create them (never overwrites existing rows; pass --update to refresh)
npm run dev                           # http://127.0.0.1:4000   (npm start for production)
```

`GET http://127.0.0.1:4000/api/health` → `{"status":"ok","db":"up"}`

Forgot a password? `npm run create-admin -- --email you@example.com --reset` (revokes all sessions).

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `4000` / `127.0.0.1` | bind `0.0.0.0` only behind a reverse proxy |
| `DATABASE_URL` **or** `DB_HOST/PORT/USER/PASSWORD/NAME` | `127.0.0.1:3306`, user/db `westquest` | |
| `PUBLIC_URL` | `http://localhost:$PORT` | base of the absolute image URLs in responses |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated browser origins (storefront + admin UI) |
| `SESSION_TTL_HOURS` | `12` | admin session lifetime |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` | `true` in production / `lax` | use `SAMESITE=none` + HTTPS if the UI is on a different *site* |
| `TRUST_PROXY` | off | set (e.g. `1`) behind a proxy so rate limiting sees real IPs |
| `MAX_UPLOAD_MB` | `6` | per image |

The server refuses to start on invalid config and tells you what's wrong.

## Importing photos from a local folder

`npm run import-images` loads product photos into the database from a folder
on disk — it **never fetches anything from the internet**. You place
legitimately-sourced images (manufacturer press kits, your own photography,
a licensed supplier) into one folder per product first.

```bash
npm run import-images -- --list      # print the exact folder every product expects
npm run import-images -- --dry-run   # preview what would be imported
npm run import-images                # import (skips products that already have photos)
npm run import-images -- --replace   # delete existing photos first, then reload
```

Expected layout under `IMAGES_ROOT` (default `~/Desktop/programming/west-quest-images`):

```
smartphones/Infinix GT 50 Pro (12+256)/Infinix GT 50 Pro (12+256) - 1.jpg
smartphones/Infinix GT 50 Pro (12+256)/Infinix GT 50 Pro (12+256) - 2.jpg
tablets/Infinix XPAD 30E (128+4)/Infinix XPAD 30E (128+4) - 1.jpg
```

`- 1` is the primary photo; `.jpg`/`.jpeg`/`.png`/`.webp` all work, and the
real file type is verified from its bytes before anything is stored.
Products that already have photos are skipped, so re-running is safe.

## Pricing model

There is no flat `price` column. Each product has an `rrp` (cash price) and
up to two rows in `payment_plans` — one per tier (`retail`, `vip`) — each
with `depositPercent`, `depositAmount`, and a daily rate for 6/9/12 months.
`retail` is required once a product is priced; `vip` is the exception, not
the rule. Plans are managed via `PUT/DELETE /api/admin/products/:id/plans/:tier`
and are embedded in every product response as `paymentPlans: [...]`.

## Images

Photos are stored **in MariaDB** (`product_images`, `LONGBLOB`), not on disk.

* Photos are served at `GET /images/p/<image id>`. Response URLs include `?v=<updated time>` so browsers
  can cache them forever and still see changes. Product lists only read metadata, never the blobs.
* **Upload** appends to the end of the gallery. The file type is verified from its bytes, not the
  filename/MIME. Max 30 images per product, `MAX_UPLOAD_MB` each. In responses `file` is the image id.
* **Reorder** takes every image id in the new order — the first becomes the primary image.
* **Delete an image** removes it and closes the gap. **Deleting a product deletes its photos.**
* MariaDB's `max_allowed_packet` must exceed your largest image (the default 16 MB is plenty).
* Back up the database and you've backed up the photos too.

## API

All errors: `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "path": "rrp", "message": "…" }] } }`
(`400 BAD_REQUEST`, `401 UNAUTHENTICATED / INVALID_CREDENTIALS`, `403 FORBIDDEN`, `404 NOT_FOUND`,
`409 DUPLICATE / CATEGORY_IN_USE / TOO_MANY_IMAGES / ITEM_UNAVAILABLE`, `413 PAYLOAD_TOO_LARGE`,
`415 UNSUPPORTED_MEDIA`, `422 VALIDATION_ERROR`, `429 RATE_LIMITED`).

### Storefront (public, read-only — active products in active categories only)

| | |
|---|---|
| `GET /api/products` | `?q=&category=&brand=&ram=&storage=&minRrp=&maxRrp=&inStock=true&featured=true&sort=&page=&limit=` → `{ items, total, page, limit, totalPages }`. `sort`: `featured` (default) · `rrp-asc` · `rrp-desc` · `name` · `newest`. `limit` ≤ 200 (default 50). |
| `GET /api/products/:slug` | one product, with embedded `paymentPlans[]` |
| `GET /api/categories` | `{ items: [{ slug, name, shortName, description, icon, order, productCount }] }` |
| `POST /api/applications` | submit a financing application: `{ productSlug, tier, termMonths, customer: { name, phone, idNumber?, location? }, notes? }` → the snapshot (ref, deposit, daily, etc). Deposit/daily are read server-side from the product's current plan — never trusted from the client. |
| `POST /api/applications/track` `{ ref, phone }` | public status lookup; a wrong ref and a wrong phone return the identical `404`. POST (not GET) so the phone never lands in a URL. |
| `GET /images/…` | photos |
| `GET /api/health` | liveness + DB check |

### Admin (cookie session required — everything under `/api/admin`)

| | |
|---|---|
| `POST /api/admin/auth/login` `{ email, password }` | sets the `wq_admin_session` cookie → `{ admin }` |
| `POST /api/admin/auth/logout` | revokes the session server-side (idempotent) |
| `GET /api/admin/auth/me` | current admin |
| `POST /api/admin/auth/change-password` `{ currentPassword, newPassword }` | signs out all *other* sessions |
| `GET /api/admin/products` | same filters as the storefront **plus** inactive products and `active=true\|false` |
| `POST /api/admin/products` | create → 201. Required: `name, sku, category (slug), rrp`. Optional: `slug, brand, modelCode, ram, storage, description, specs[{label,value}], inStock, stockCount, badge, featured, featureRank, active, adminNotes` |
| `GET/PATCH/DELETE /api/admin/products/:id` | one product / partial update / delete (204; photos + plans cascade) |
| `PUT /api/admin/products/:id/plans/:tier` | `tier`: `retail` or `vip`. Body: `{ depositPercent, depositAmount, daily6, daily9, daily12 }` → `{ paymentPlans }` |
| `DELETE /api/admin/products/:id/plans/:tier` | stop offering that tier → `{ paymentPlans }` |
| `GET /api/admin/categories` · `GET/PATCH/DELETE /api/admin/categories/:id` · `POST /api/admin/categories` | slug is immutable. `DELETE` on a category that has products → `409 CATEGORY_IN_USE`; retry with `?reassignTo=<slug>` to move them (atomic) |
| `GET /api/admin/products/:id/images` · `POST .../images` (multipart `images`, 1–10) · `PUT .../images/order` `{files}` · `DELETE .../images/:file` | photo management |
| `GET /api/admin/applications` | `?status=&q=&page=&limit=` → paginated list |
| `GET /api/admin/applications/:id` | one application, with `adminNotes` |
| `PATCH /api/admin/applications/:id` | `{ status?, adminNotes? }` — `status` one of `pending/contacted/approved/rejected` |
| `GET /api/admin/stats` | dashboard numbers (pending/contacted/approved applications, low stock, pending reviews) |
| `POST /api/admin/products/bulk` `{ items }` | create-or-update by SKU |
| `GET /api/admin/reviews` · `PATCH/DELETE /api/admin/reviews/:id` | moderate (`approved` filter, `{ approved }`) |
| `GET/POST /api/admin/banners` · `PATCH/DELETE /api/admin/banners/:id` · `PUT /api/admin/banners/order` `{ ids }` · `POST /api/admin/banners/image` | manage homepage slides |
| `GET/POST /api/admin/admins` · `PATCH/DELETE /api/admin/admins/:id` | team management (`{ active }`, `{ password }`, `{ name }`) |

```bash
# sign in (keeps the cookie), set a retail plan, upload a photo
curl -c jar -H 'content-type: application/json' -d '{"email":"you@example.com","password":"…"}' localhost:4000/api/admin/auth/login
curl -b jar -X PUT -H 'content-type: application/json' \
  -d '{"depositPercent":20,"depositAmount":3120,"daily6":115,"daily9":95,"daily12":86}' \
  localhost:4000/api/admin/products/1/plans/retail
curl -b jar -F 'images=@photo.jpg' localhost:4000/api/admin/products/1/images
```

From the browser use `fetch(url, { credentials: 'include' })` and add the UI's origin to `CORS_ORIGINS`.

## Security notes

* **Sessions, not JWTs**: a random token in an `HttpOnly` cookie (`SameSite=Lax`, `Secure` in production,
  path-scoped to `/api/admin`); only its SHA-256 is stored, so logout/expiry/deactivation/password change
  take effect immediately and a DB leak doesn't leak live sessions. Passwords are bcrypt (cost 12).
* Login: identical error for unknown email vs wrong password (and equalised timing); **failed** attempts are
  rate-limited (10 / 15 min / IP → 429).
* CSRF: cookie auth plus an **Origin allow-list check** on every state-changing admin request.
  CORS only for `CORS_ORIGINS`. `helmet` headers. JSON bodies capped at 100 KB.
* All input validated with zod (strict types); all SQL is parameterised, sort options are whitelisted,
  `LIKE` wildcards in searches are escaped.
* Uploads: real file type checked from magic bytes, size-capped, stored with a fixed MIME and served with `nosniff`;
  per-product row lock serialises uploads/reorders.
* Applications never mutate `stock_count` — approval is a manual sales decision made offline.
* Deploy behind HTTPS (nginx/Caddy) and set `TRUST_PROXY`, `PUBLIC_URL`, `CORS_ORIGINS`.

## Tests

`npm test` — integration tests that boot the real app against a **throwaway MariaDB database**. Point them at
a database you can wipe:

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3306 TEST_DB_USER=wq_test TEST_DB_PASSWORD=… TEST_DB_NAME=wq_test npm test
```

The database name **must end in `_test`** (the suite drops its tables). Never point it at production.

## New-application alerts

Set `NOTIFY_EMAIL_TO` (comma-separated) plus `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` (see
`.env.example`). Every accepted application sends one email with the device, plan and customer details.
Sending is fire-and-forget: an SMTP failure is logged and never affects submission. With no SMTP config
nothing is sent.

## Running behind the Next.js storefront

The storefront forwards `/api/*` and `/images/*` to this server (`BACKEND_URL` in its `.env.local`), so the
browser only ever sees one origin. In that setup set `PUBLIC_URL` to the **storefront's** public URL,
`CORS_ORIGINS` to the same, and `TRUST_PROXY=1`.
