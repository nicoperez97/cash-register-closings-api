-- Cuentas de movimiento opcionales (ingreso/egreso parcial).
ALTER TABLE movements
  MODIFY COLUMN fromAccountId VARCHAR(36) NULL,
  MODIFY COLUMN toAccountId VARCHAR(36) NULL;
