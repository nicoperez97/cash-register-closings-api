-- Categorías de uso de conceptos (JSON array) y vínculo concepto → pago.
-- Config del local: qué categorías listar en cada tipo de pago.

ALTER TABLE concepts
  ADD COLUMN categories JSON NULL;

UPDATE concepts
  SET categories = JSON_ARRAY('MOVEMENTS')
  WHERE categories IS NULL AND deletedAt IS NULL;

ALTER TABLE payments
  ADD COLUMN conceptId CHAR(36) NULL;

ALTER TABLE shops
  ADD COLUMN paymentConceptCategories JSON NULL;
