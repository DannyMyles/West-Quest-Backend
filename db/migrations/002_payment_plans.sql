-- 002: financing terms. Max 2 rows per product (tier is a fixed 2-value set),
-- unlike product_images' variable-length list — term is a closed 6/9/12 enum,
-- so it's three columns per tier rather than a separate per-term row. Absence
-- of a 'vip' row simply means VIP isn't offered for that product yet.

CREATE TABLE IF NOT EXISTS payment_plans (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id      INT UNSIGNED NOT NULL,
  tier            ENUM('retail','vip') NOT NULL,
  deposit_percent DECIMAL(5,2) NOT NULL,   -- e.g. 20.00 / 10.00 / 15.00, as printed in the catalogue
  deposit_amount  INT UNSIGNED NOT NULL,   -- KES
  daily_6         INT UNSIGNED NOT NULL,   -- daily payment, 6-month term
  daily_9         INT UNSIGNED NOT NULL,
  daily_12        INT UNSIGNED NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_plans_product_tier (product_id, tier),
  CONSTRAINT fk_payment_plans_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
