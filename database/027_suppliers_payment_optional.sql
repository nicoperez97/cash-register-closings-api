-- Proveedores + pagos opcionales en pagos

ALTER TABLE ledger_accounts
  MODIFY COLUMN type ENUM('PARTNER', 'CHANNEL', 'SYSTEM', 'SUPPLIER') NOT NULL DEFAULT 'PARTNER';

CREATE TABLE IF NOT EXISTS suppliers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  notes VARCHAR(500) NULL,
  accountId CHAR(36) NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_suppliers_shop (shopId),
  INDEX idx_suppliers_account (accountId)
);

ALTER TABLE payments
  MODIFY COLUMN title VARCHAR(200) NULL,
  MODIFY COLUMN amount DECIMAL(14,2) NULL,
  MODIFY COLUMN dueDate DATE NULL,
  MODIFY COLUMN payerUserId CHAR(36) NULL,
  MODIFY COLUMN validatorUserId CHAR(36) NULL,
  MODIFY COLUMN accountId CHAR(36) NULL;

ALTER TABLE payments
  ADD COLUMN supplierId CHAR(36) NULL;

CREATE INDEX idx_payments_supplier ON payments (supplierId);
