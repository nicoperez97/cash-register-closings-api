-- Pagos a validar / pagar + notificaciones in-app
CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  title VARCHAR(200) NOT NULL,
  notes VARCHAR(500) NULL,
  amount DECIMAL(14,2) NOT NULL,
  dueDate DATE NOT NULL,
  payerUserId CHAR(36) NOT NULL,
  validatorUserId CHAR(36) NOT NULL,
  accountId CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VALIDATION',
  paidAt DATE NULL,
  validatedAt DATETIME(6) NULL,
  validatedByUserId CHAR(36) NULL,
  createdByUserId CHAR(36) NULL,
  movementId CHAR(36) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_payments_shop (shopId),
  INDEX idx_payments_status (status),
  INDEX idx_payments_payer (payerUserId),
  INDEX idx_payments_validator (validatorUserId)
);

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  userId CHAR(36) NOT NULL,
  shopId CHAR(36) NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body VARCHAR(500) NOT NULL,
  paymentId CHAR(36) NULL,
  isRead TINYINT(1) NOT NULL DEFAULT 0,
  readAt DATETIME(6) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_notifications_user (userId),
  INDEX idx_notifications_read (isRead)
);
