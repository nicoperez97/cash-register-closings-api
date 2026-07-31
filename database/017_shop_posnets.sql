USE cash_register_closings;

-- Posnets configurados por local: [{ id, name, type: PVS|MERCADO_PAGO|CUENTA_DNI }]
ALTER TABLE shops
  ADD COLUMN posnets JSON NULL AFTER posPaymentMap;

-- Montos por posnet en cada cierre (snapshot): [{ posnetId, name, type, amount }]
ALTER TABLE cash_closings
  ADD COLUMN posnetAmounts JSON NULL AFTER otherAmount;
