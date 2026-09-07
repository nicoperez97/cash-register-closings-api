-- Si es false, la cuenta no aparece en el panel de Saldos.
ALTER TABLE ledger_accounts
  ADD COLUMN listInBalances TINYINT(1) NOT NULL DEFAULT 1
  AFTER listInTransfers;
