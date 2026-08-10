-- Propinas diarias por local + reparto por empleado.
ALTER TABLE shops
  ADD COLUMN tipsEnabled TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tip_days (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  businessDate DATE NOT NULL,
  cashAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  transferAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  ticketsAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  totalAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes VARCHAR(500) NULL,
  closingId CHAR(36) NULL,
  createdByUserId CHAR(36) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tip_days_shop_date (shopId, businessDate),
  KEY idx_tip_days_shop (shopId),
  KEY idx_tip_days_date (businessDate)
);

CREATE TABLE IF NOT EXISTS tip_allocations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tipDayId CHAR(36) NOT NULL,
  employeeId CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  delivered TINYINT(1) NOT NULL DEFAULT 0,
  deliveredAt DATETIME(6) NULL,
  deliveredByUserId CHAR(36) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tip_alloc_day_emp (tipDayId, employeeId),
  KEY idx_tip_alloc_day (tipDayId),
  KEY idx_tip_alloc_emp (employeeId),
  KEY idx_tip_alloc_delivered (delivered)
);
