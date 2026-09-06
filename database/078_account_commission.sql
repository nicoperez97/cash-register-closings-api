ALTER TABLE ledger_accounts
  ADD COLUMN commissionPercent DECIMAL(6,2) NOT NULL DEFAULT 0;
