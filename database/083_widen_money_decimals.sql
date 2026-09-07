-- Montos grandes (pruebas / locales con saldos altos). DECIMAL(14,2) tope ~1e12.
ALTER TABLE movements
  MODIFY COLUMN amountUyu DECIMAL(20,2) NOT NULL DEFAULT 0;

ALTER TABLE payments
  MODIFY COLUMN amount DECIMAL(20,2) NULL;

ALTER TABLE partner_split_runs
  MODIFY COLUMN distributedAmount DECIMAL(20,2) NOT NULL DEFAULT 0;

ALTER TABLE ledger_accounts
  MODIFY COLUMN openingBalance DECIMAL(20,2) NOT NULL DEFAULT 0;
