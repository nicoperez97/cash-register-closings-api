-- Descripción y flag de validación en conceptos.
-- Los movimientos / gasto rápido solo listan conceptos validados.

ALTER TABLE concepts
  ADD COLUMN description TEXT NULL;

ALTER TABLE concepts
  ADD COLUMN validated TINYINT(1) NOT NULL DEFAULT 1;
