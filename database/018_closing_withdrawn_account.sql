-- Destino contable del efectivo retirado (cuenta del usuario que se lo lleva).
ALTER TABLE cash_closings
  ADD COLUMN cashWithdrawnToAccountId VARCHAR(36) NULL AFTER cashWithdrawnByName;
