-- Pagos a socios que al abonar van a Dividendos (toAccountId = socio anotado).
ALTER TABLE payments
  ADD COLUMN isDividend TINYINT(1) NOT NULL DEFAULT 0;
