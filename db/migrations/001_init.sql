-- 001: core tables (categories, products, admins, admin_sessions).
-- `rrp` is the catalogue's recommended retail (cash) price, in whole Kenyan
-- shillings (KES). There is deliberately no flat `price` column here — actual
-- sale terms (deposit + daily payment per tier) live in the `payment_plans`
-- child table added by migration 002.

CREATE TABLE IF NOT EXISTS categories (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug         VARCHAR(64)  NOT NULL,
  name         VARCHAR(120) NOT NULL,
  short_name   VARCHAR(60)  NOT NULL,
  description  VARCHAR(500) NOT NULL DEFAULT '',
  icon         VARCHAR(40)  NOT NULL DEFAULT 'package',
  sort_order   INT          NOT NULL DEFAULT 0,
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug         VARCHAR(190) NOT NULL,
  sku          VARCHAR(80)  NOT NULL,
  name         VARCHAR(255) NOT NULL,
  category_id  INT UNSIGNED NOT NULL,
  brand        VARCHAR(80)  NULL,
  model_code   VARCHAR(40)  NULL,           -- catalogue's model code, e.g. "X6891"
  ram          VARCHAR(20)  NULL,           -- e.g. "12GB" (also mirrored into specs)
  storage      VARCHAR(20)  NULL,           -- e.g. "256GB" (also mirrored into specs)
  rrp          INT UNSIGNED NOT NULL,       -- recommended retail (cash) price, KES
  description  TEXT         NOT NULL,
  specs        JSON         NULL,
  in_stock     TINYINT(1)   NOT NULL DEFAULT 1,
  stock_count  INT UNSIGNED NULL,
  badge        VARCHAR(20)  NULL,
  featured     TINYINT(1)   NOT NULL DEFAULT 0,
  feature_rank INT          NULL,
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  rating       DECIMAL(2,1) NULL,
  review_count INT UNSIGNED NULL,
  admin_notes  TEXT         NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  UNIQUE KEY uq_products_sku (sku),
  KEY ix_products_category (category_id, active),
  KEY ix_products_rrp (rrp),
  KEY ix_products_brand (brand),
  KEY ix_products_created (created_at),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email          VARCHAR(190) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions: only a SHA-256 of the cookie token is stored, so a DB
-- leak doesn't hand out live sessions, and logout really revokes access.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id    INT UNSIGNED    NOT NULL,
  token_hash  CHAR(64)        NOT NULL,
  ip          VARCHAR(64)     NULL,
  user_agent  VARCHAR(255)    NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_admin FOREIGN KEY (admin_id)
    REFERENCES admins (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
