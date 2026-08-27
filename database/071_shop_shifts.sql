-- Turnos por local: apertura/cierre de turno. El cierre de caja y el presentismo van por turno.

ALTER TABLE shops
  ADD COLUMN shifts JSON NULL;

ALTER TABLE cash_closings
  ADD COLUMN shiftId VARCHAR(36) NULL,
  ADD COLUMN shiftName VARCHAR(80) NULL;

ALTER TABLE attendance_days
  ADD COLUMN shiftId VARCHAR(36) NULL;

-- El backfill de JSON, claves únicas y el unique de presentismo lo hace onModuleInit
-- (un turno default por local a partir de openingTime).
