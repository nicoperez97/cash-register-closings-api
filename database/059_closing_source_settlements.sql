-- Rendiciones pendientes de cuentas aparte (SETTLE_CASH / SETTLE_ACCOUNT).
ALTER TABLE closing_source_amounts
  ADD COLUMN settledAt DATETIME(6) NULL,
  ADD COLUMN settledToAccountId VARCHAR(36) NULL,
  ADD COLUMN settledByUserId VARCHAR(36) NULL,
  ADD COLUMN settledByName VARCHAR(200) NULL,
  ADD COLUMN settlementMovementId VARCHAR(36) NULL,
  ADD COLUMN settleBatchId VARCHAR(36) NULL;

CREATE INDEX IDX_closing_source_amounts_settle_batch
  ON closing_source_amounts (settleBatchId);
