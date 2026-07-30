-- Rubros / subrubros POS + vínculo en productos y líneas

CREATE TABLE IF NOT EXISTS pos_categories (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  name VARCHAR(128) NOT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  notes TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_pos_category_shop_name (shopId, name),
  KEY idx_pos_category_shop (shopId, sortOrder)
);

CREATE TABLE IF NOT EXISTS pos_subcategories (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  categoryId CHAR(36) NOT NULL,
  name VARCHAR(128) NOT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  notes TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_pos_subcat_shop_cat_name (shopId, categoryId, name),
  KEY idx_pos_subcat_cat (shopId, categoryId)
);

ALTER TABLE pos_products
  ADD COLUMN subcategory VARCHAR(128) NULL,
  ADD COLUMN categoryId CHAR(36) NULL,
  ADD COLUMN subcategoryId CHAR(36) NULL;

ALTER TABLE pos_sale_ticket_lines
  ADD COLUMN subcategory VARCHAR(128) NULL;
