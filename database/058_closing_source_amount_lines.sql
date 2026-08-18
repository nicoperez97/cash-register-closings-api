-- Desglose de montos por fuente extra del cierre (Pedidos Ya, delivery…).
ALTER TABLE closing_source_amounts
  ADD COLUMN lines JSON NULL;
