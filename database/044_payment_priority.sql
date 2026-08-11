-- Prioridad opcional del pago (low / medium / high)
ALTER TABLE payments
  ADD COLUMN priority VARCHAR(16) NULL AFTER dueDate;
