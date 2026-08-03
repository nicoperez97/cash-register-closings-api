-- Ocultar cuenta del selector “Quién se lo lleva” en el cierre.
ALTER TABLE ledger_accounts
  ADD COLUMN hideFromCashWithdraw TINYINT(1) NOT NULL DEFAULT 0
  AFTER linkedPaymentMethod;
