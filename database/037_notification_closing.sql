ALTER TABLE notifications
  ADD COLUMN closingId CHAR(36) NULL AFTER paymentId;
