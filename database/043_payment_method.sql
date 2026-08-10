-- Forma de pago (efectivo / transferencia / tarjeta / otra)
ALTER TABLE payments
  ADD COLUMN paymentMethod VARCHAR(32) NULL AFTER accountId;
