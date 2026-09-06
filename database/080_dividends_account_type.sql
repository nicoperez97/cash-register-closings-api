-- Cuenta Dividendos (una por local). Amplía el enum de tipos_accounts.type.
ALTER TABLE ledger_accounts
  MODIFY COLUMN type ENUM('PARTNER', 'CHANNEL', 'SYSTEM', 'SUPPLIER', 'SERVICE', 'DIVIDENDS')
  NOT NULL DEFAULT 'PARTNER';
