-- Sistemas de ventas + reportes POS (MySQL)
-- Con DB_SYNC=true TypeORM también crea/actualiza estas tablas.

CREATE TABLE IF NOT EXISTS sales_systems (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  parserKey VARCHAR(64) NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_sales_systems_code (code)
);

ALTER TABLE shops
  ADD COLUMN salesSystemId CHAR(36) NULL;

ALTER TABLE shops
  ADD COLUMN posPaymentMap TEXT NULL;

CREATE TABLE IF NOT EXISTS pos_sale_imports (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  salesSystemId CHAR(36) NOT NULL,
  fileName VARCHAR(255) NULL,
  periodFrom DATE NULL,
  periodTo DATE NULL,
  ticketCount INT NOT NULL DEFAULT 0,
  importedByUserId CHAR(36) NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  KEY idx_pos_import_shop (shopId)
);

CREATE TABLE IF NOT EXISTS pos_sale_tickets (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  importId CHAR(36) NOT NULL,
  salesSystemId CHAR(36) NOT NULL,
  businessDate DATE NOT NULL,
  externalId VARCHAR(64) NOT NULL,
  ticketType VARCHAR(16) NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount DECIMAL(14,2) NOT NULL DEFAULT 0,
  paymentCode VARCHAR(32) NULL,
  covers INT NOT NULL DEFAULT 0,
  externalClosingId VARCHAR(64) NULL,
  occurredAt VARCHAR(32) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_pos_ticket_ext (shopId, salesSystemId, externalId),
  KEY idx_pos_ticket_date (shopId, businessDate)
);

CREATE TABLE IF NOT EXISTS pos_sale_ticket_lines (
  id CHAR(36) PRIMARY KEY,
  ticketId CHAR(36) NOT NULL,
  productCode VARCHAR(64) NULL,
  productName VARCHAR(255) NULL,
  qty DECIMAL(12,3) NOT NULL DEFAULT 0,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  KEY idx_pos_line_ticket (ticketId)
);

CREATE TABLE IF NOT EXISTS pos_sale_dailies (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  businessDate DATE NOT NULL,
  salesSystemId CHAR(36) NOT NULL,
  importId CHAR(36) NOT NULL,
  totalAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  ticketCount INT NOT NULL DEFAULT 0,
  coversCount INT NOT NULL DEFAULT 0,
  cashAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  cardAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  mercadoPagoAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  deliveryAppsAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  transferAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  accountDniAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  otherAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_pos_daily (shopId, businessDate, salesSystemId)
);
