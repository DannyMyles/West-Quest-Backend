-- 003: product photos live in the database. `position` 1 is the primary image.

CREATE TABLE IF NOT EXISTS product_images (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  INT UNSIGNED NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL,
  file_name   VARCHAR(255) NOT NULL,             -- original file name, informational
  mime        VARCHAR(40)  NOT NULL,
  size        INT UNSIGNED NOT NULL,
  data        LONGBLOB     NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_product_images_product (product_id, position),
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
