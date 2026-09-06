ALTER TABLE ledger_accounts
  ADD COLUMN ownershipPercent DECIMAL(6,2) NOT NULL DEFAULT 0;
