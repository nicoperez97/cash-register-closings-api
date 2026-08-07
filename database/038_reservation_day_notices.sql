-- Avisos del día para pantalla pública de reservas (1 por shop + fecha).
CREATE TABLE IF NOT EXISTS reservation_day_notices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  businessDate DATE NOT NULL,
  message TEXT NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY UQ_reservation_day_notices_shop_date (shopId, businessDate),
  INDEX IDX_reservation_day_notices_shop_date (shopId, businessDate)
);
