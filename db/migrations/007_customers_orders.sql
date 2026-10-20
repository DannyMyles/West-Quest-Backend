-- 007: customer accounts (phone + password), their sessions, and cash orders.
-- Applications gain an owning customer. A customer only ever sees records
-- created while signed in to their account — phone numbers are not verified,
-- so nothing is matched to an account by phone number alone.

CREATE TABLE IF NOT EXISTS customers (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120) NOT NULL,
  phone          VARCHAR(30)  NOT NULL,
  phone_key      CHAR(9)      NOT NULL,            -- last 9 digits: the login identity
  password_hash  VARCHAR(100) NOT NULL,
  location       VARCHAR(190) NULL,
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_phone_key (phone_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  INT UNSIGNED    NOT NULL,
  token_hash   CHAR(64)        NOT NULL,
  ip           VARCHAR(64)     NULL,
  user_agent   VARCHAR(255)    NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_sessions_token (token_hash),
  KEY ix_customer_sessions_expires (expires_at),
  CONSTRAINT fk_customer_sessions_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS customer_id INT UNSIGNED NULL AFTER id,
  ADD KEY IF NOT EXISTS ix_applications_customer (customer_id, created_at),
  ADD CONSTRAINT fk_applications_customer FOREIGN KEY IF NOT EXISTS (customer_id)
    REFERENCES customers (id) ON DELETE SET NULL;

-- Cash (pay-in-full) orders: header snapshot + line items, like the
-- applications table snapshots prices at submission. Stock is not touched —
-- the sales team confirms availability and payment over WhatsApp.
CREATE TABLE IF NOT EXISTS orders (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ref             VARCHAR(16)  NOT NULL,            -- customer-facing, e.g. "WC-K7Q2XM"
  customer_id     INT UNSIGNED NULL,
  customer_name   VARCHAR(120) NOT NULL,
  customer_phone  VARCHAR(30)  NOT NULL,
  phone_key       CHAR(9)      NOT NULL,
  location        VARCHAR(190) NULL,
  notes           VARCHAR(1000) NULL,
  total           INT UNSIGNED NOT NULL,
  status          ENUM('pending','confirmed','completed','cancelled') NOT NULL DEFAULT 'pending',
  admin_notes     TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_ref (ref),
  KEY ix_orders_status_created (status, created_at),
  KEY ix_orders_customer (customer_id, created_at),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      INT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED NULL,
  product_sku   VARCHAR(80)  NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  product_slug  VARCHAR(190) NOT NULL,
  unit_price    INT UNSIGNED NOT NULL,
  quantity      SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY ix_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL,
  CONSTRAINT ck_order_items_qty CHECK (quantity BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
