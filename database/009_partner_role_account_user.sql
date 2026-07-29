-- Rol Socio (PARTNER) + vínculo usuario ↔ cuenta contable (MySQL)
-- Con DB_SYNC=true TypeORM también aplica estos cambios al reiniciar la API.

ALTER TABLE users
  MODIFY COLUMN globalRole ENUM('OWNER','ADMIN','MANAGER','CASHIER','VIEWER','PARTNER')
  NOT NULL DEFAULT 'CASHIER';

ALTER TABLE user_shops
  MODIFY COLUMN shopRole ENUM('OWNER','ADMIN','MANAGER','CASHIER','VIEWER','PARTNER') NULL;

-- Si la columna ya existe, omití esta línea.
ALTER TABLE ledger_accounts
  ADD COLUMN userId CHAR(36) NULL;

ALTER TABLE ledger_accounts
  ADD INDEX idx_ledger_accounts_user (userId);
