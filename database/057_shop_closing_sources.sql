-- Fuentes extra por local (Pedidos Ya, delivery, cuentas aparte) y montos en cada cierre.
CREATE TABLE IF NOT EXISTS shop_closing_sources (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  includeInDeclared TINYINT NOT NULL DEFAULT 0,
  kind ENUM('OWN_ACCOUNT','SETTLE_CASH','SETTLE_ACCOUNT','RECORD_ONLY') NOT NULL DEFAULT 'RECORD_ONLY',
  accountId CHAR(36) NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  KEY IDX_shop_closing_sources_shop (shopId)
);

CREATE TABLE IF NOT EXISTS closing_source_amounts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  closingId CHAR(36) NOT NULL,
  sourceId CHAR(36) NULL,
  name VARCHAR(120) NOT NULL,
  includeInDeclared TINYINT NOT NULL DEFAULT 0,
  kind ENUM('OWN_ACCOUNT','SETTLE_CASH','SETTLE_ACCOUNT','RECORD_ONLY') NOT NULL DEFAULT 'RECORD_ONLY',
  accountId CHAR(36) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  KEY IDX_closing_source_amounts_closing (closingId)
);
