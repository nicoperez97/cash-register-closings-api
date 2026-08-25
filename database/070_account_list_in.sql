-- Dónde aparece cada cuenta al cargar movimientos.
ALTER TABLE ledger_accounts
  ADD COLUMN listInExpenses TINYINT(1) NOT NULL DEFAULT 1
  AFTER hideFromCashWithdraw,
  ADD COLUMN listInIncomes TINYINT(1) NOT NULL DEFAULT 1
  AFTER listInExpenses,
  ADD COLUMN listInTransfers TINYINT(1) NOT NULL DEFAULT 1
  AFTER listInIncomes;
