-- Asociación N:N usuario ↔ cuenta contable

CREATE TABLE IF NOT EXISTS ledger_account_users (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  accountId CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  UNIQUE KEY uq_ledger_account_user (accountId, userId),
  KEY idx_lau_shop (shopId),
  KEY idx_lau_user (userId),
  KEY idx_lau_account (accountId)
);

-- Migrar vínculos previos (1 cuenta → 1 usuario) si existía userId
INSERT IGNORE INTO ledger_account_users (id, shopId, accountId, userId)
SELECT UUID(), a.shopId, a.id, a.userId
FROM ledger_accounts a
WHERE a.userId IS NOT NULL
  AND a.deletedAt IS NULL;

-- Opcional: quitar la columna vieja (descomentar si ya no se usa)
-- ALTER TABLE ledger_accounts DROP COLUMN userId;
