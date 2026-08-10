-- Recibos individuales en propinas diarias (suma → transferAmount).
ALTER TABLE tip_days
  ADD COLUMN receipts TEXT NULL;
