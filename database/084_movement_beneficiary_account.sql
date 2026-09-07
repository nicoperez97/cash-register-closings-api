-- Socio anotado en dividendos (el dinero va a Dividendos; no mueve saldo del beneficiario).
ALTER TABLE movements
  ADD COLUMN beneficiaryAccountId CHAR(36) NULL;
