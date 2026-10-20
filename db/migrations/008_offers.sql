-- 008: special offers. A product is "on offer" when `was_price` is higher than
-- its current cash price (`rrp`) and the optional `offer_ends_at` hasn't
-- passed — so an offer with an end date lapses on its own.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS was_price INT UNSIGNED NULL AFTER rrp,
  ADD COLUMN IF NOT EXISTS offer_ends_at DATETIME NULL AFTER was_price;
