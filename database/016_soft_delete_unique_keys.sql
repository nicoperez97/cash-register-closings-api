-- Soft-delete friendly unique for closings.
-- Important: create a dedicated shopId index BEFORE dropping the old
-- (shopId, businessDate) unique, because MySQL FKs reuse that composite index.

ALTER TABLE cash_closings
  ADD COLUMN businessDateKey VARCHAR(80) NULL AFTER businessDate;

UPDATE cash_closings
SET businessDateKey = DATE_FORMAT(businessDate, '%Y-%m-%d')
WHERE businessDateKey IS NULL OR businessDateKey = '';

CREATE INDEX IDX_cash_closings_shopId ON cash_closings (shopId);

ALTER TABLE cash_closings
  ADD UNIQUE KEY uq_shop_date_key (shopId, businessDateKey);

-- Drop old unique (name may be uq_shop_date or TypeORM IDX_...).
-- ALTER TABLE cash_closings DROP INDEX uq_shop_date;
