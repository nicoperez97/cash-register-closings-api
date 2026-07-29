-- Catálogo de platos/productos + rubro en líneas POS

CREATE TABLE IF NOT EXISTS pos_products (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  productCode VARCHAR(64) NOT NULL,
  productName VARCHAR(255) NULL,
  category VARCHAR(128) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_pos_product_shop_code (shopId, productCode),
  KEY idx_pos_product_category (shopId, category)
);

ALTER TABLE pos_sale_ticket_lines
  ADD COLUMN category VARCHAR(128) NULL;
