-- 006: uploaded homepage-banner pictures, stored like product photos (served at /images/b/:id).
CREATE TABLE IF NOT EXISTS banner_images (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  mime        VARCHAR(40)  NOT NULL,
  size        INT UNSIGNED NOT NULL,
  data        LONGBLOB     NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
