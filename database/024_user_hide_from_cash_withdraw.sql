-- Ocultar usuario del selector “Quién se lo lleva” en el cierre (por local).
ALTER TABLE user_shops
  ADD COLUMN hideFromCashWithdraw TINYINT(1) NOT NULL DEFAULT 0;
