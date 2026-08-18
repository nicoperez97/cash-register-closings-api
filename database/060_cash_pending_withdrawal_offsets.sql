-- Gastos de caja que descuentan retiros pendientes (el efectivo ya se usó).
CREATE TABLE IF NOT EXISTS cash_pending_withdrawal_offsets (
  id VARCHAR(36) NOT NULL,
  shopId VARCHAR(36) NOT NULL,
  pendingId VARCHAR(36) NOT NULL,
  movementId VARCHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY UQ_cash_wd_offsets_pending_movement (pendingId, movementId),
  KEY IDX_cash_wd_offsets_pending (pendingId),
  KEY IDX_cash_wd_offsets_movement (movementId)
);
