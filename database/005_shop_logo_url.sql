-- MySQL 8: si la columna ya existe, ignorá el error.
ALTER TABLE shops ADD COLUMN logoUrl VARCHAR(500) NULL AFTER defaultChangeAmount;
