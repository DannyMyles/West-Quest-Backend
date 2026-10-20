-- 004: financing applications — the lease-to-own equivalent of an order.
-- Header-snapshot pattern, no line-items table: one application = one device
-- + one plan. Snapshots the chosen product/plan figures at submission time so
-- later product or pricing edits never rewrite history. No stock is touched
-- here — approval is a manual sales-team decision made offline.

CREATE TABLE IF NOT EXISTS applications (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ref             VARCHAR(16)  NOT NULL,            -- customer-facing, e.g. "WQ-K7Q2XM"
  product_id      INT UNSIGNED NULL,                -- kept if the product is later deleted
  product_sku     VARCHAR(80)  NOT NULL,
  product_name    VARCHAR(255) NOT NULL,
  product_slug    VARCHAR(190) NOT NULL,
  tier            ENUM('retail','vip') NOT NULL,
  term_months     TINYINT UNSIGNED NOT NULL,
  rrp             INT UNSIGNED NOT NULL,
  deposit_amount  INT UNSIGNED NOT NULL,
  daily_amount    INT UNSIGNED NOT NULL,
  customer_name   VARCHAR(120) NOT NULL,
  customer_phone  VARCHAR(30)  NOT NULL,
  phone_key       CHAR(9)      NOT NULL,            -- last 9 digits, used to match on /track
  id_number       VARCHAR(20)  NULL,
  location        VARCHAR(190) NULL,
  notes           VARCHAR(1000) NULL,
  status          ENUM('pending','contacted','approved','rejected') NOT NULL DEFAULT 'pending',
  admin_notes     TEXT NULL,                        -- internal only, never returned to the public API
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_applications_ref (ref),
  KEY ix_applications_status_created (status, created_at),
  KEY ix_applications_phone_key (phone_key),
  CONSTRAINT fk_applications_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL,
  CONSTRAINT ck_applications_term CHECK (term_months IN (6, 9, 12))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
