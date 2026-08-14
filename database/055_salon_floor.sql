-- Plano de salón: mesas físicas por sector y reglas de mesas armadas.
-- No afecta reservas, cupos ni el formulario público.

CREATE TABLE IF NOT EXISTS salon_tables (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  area VARCHAR(16) NOT NULL DEFAULT 'INSIDE',
  label VARCHAR(40) NOT NULL DEFAULT '',
  seats INT NOT NULL DEFAULT 2,
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_salon_tables_shop (shopId)
);

CREATE TABLE IF NOT EXISTS salon_area_rules (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  area VARCHAR(16) NOT NULL DEFAULT 'INSIDE',
  partySize INT NOT NULL,
  maxCount INT NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_salon_area_rules_shop (shopId)
);
