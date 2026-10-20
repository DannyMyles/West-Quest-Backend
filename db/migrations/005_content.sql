-- 005: homepage banners and customer reviews — final shape from day one
-- (no need to replay Best-Price's historical migration split in this fresh repo).

CREATE TABLE IF NOT EXISTS banners (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  eyebrow       VARCHAR(120)  NULL,
  headline      VARCHAR(200)  NOT NULL,
  subcopy       VARCHAR(400)  NULL,
  image         VARCHAR(1000) NOT NULL,             -- an http(s) URL or a site-relative path
  layout        VARCHAR(10)   NOT NULL DEFAULT 'photo',
  accent        CHAR(7)       NULL,                 -- '#RRGGBB'; primary button + badge colour
  badge         VARCHAR(40)   NULL,
  cta_label     VARCHAR(60)   NULL,
  cta_href      VARCHAR(500)  NULL,
  cta2_label    VARCHAR(60)   NULL,
  cta2_href     VARCHAR(500)  NULL,
  deal_ends_at  DATETIME      NULL,                 -- UTC; shows a live countdown while in the future
  active        TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order    INT           NOT NULL DEFAULT 0,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_banners_active_order (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Structurally present even though it'll be empty pre-launch — do not seed fake reviews.
CREATE TABLE IF NOT EXISTS reviews (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id     INT UNSIGNED NOT NULL,
  customer_name  VARCHAR(80)  NOT NULL,
  rating         TINYINT UNSIGNED NOT NULL,
  comment        VARCHAR(2000) NOT NULL,
  approved       TINYINT(1)   NOT NULL DEFAULT 0,   -- reviews are held until an admin approves them
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_reviews_product (product_id, approved, created_at),
  KEY ix_reviews_approved (approved, created_at),
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
