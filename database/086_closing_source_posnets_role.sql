-- Cuentas del local: posnets anidados + rol sistema (Efectivo).
-- Snapshot de posnets por fuente en cada cierre.

ALTER TABLE shop_closing_sources
  ADD COLUMN role ENUM('STANDARD', 'CASH') NOT NULL DEFAULT 'STANDARD' AFTER kind,
  ADD COLUMN posnets JSON NULL AFTER accountId;

ALTER TABLE closing_source_amounts
  ADD COLUMN role ENUM('STANDARD', 'CASH') NOT NULL DEFAULT 'STANDARD' AFTER kind,
  ADD COLUMN posnetAmounts JSON NULL AFTER lines;
