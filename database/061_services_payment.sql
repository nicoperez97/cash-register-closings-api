-- Catálogo de servicios + pagos a servicios

ALTER TABLE ledger_accounts
  MODIFY COLUMN type ENUM('PARTNER', 'CHANNEL', 'SYSTEM', 'SUPPLIER', 'SERVICE')
  NOT NULL DEFAULT 'PARTNER';

CREATE TABLE IF NOT EXISTS services (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  legalName VARCHAR(200) NULL,
  taxId VARCHAR(20) NULL,
  bankAlias VARCHAR(100) NULL,
  notes VARCHAR(500) NULL,
  accountId CHAR(36) NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_services_shop (shopId),
  INDEX idx_services_account (accountId)
);

ALTER TABLE payments
  ADD COLUMN serviceId CHAR(36) NULL;

CREATE INDEX idx_payments_service ON payments (serviceId);
