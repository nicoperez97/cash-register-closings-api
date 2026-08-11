CREATE TABLE IF NOT EXISTS reservation_requests (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  businessDate DATE NOT NULL,
  guestName VARCHAR(120) NOT NULL,
  guestEmail VARCHAR(180) NOT NULL,
  instagramHandle VARCHAR(30) NULL,
  partySize INT NOT NULL DEFAULT 2,
  reservationTime VARCHAR(5) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  reservationId CHAR(36) NULL,
  staffNote VARCHAR(500) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX IDX_reservation_requests_shop_status (shopId, status),
  INDEX IDX_reservation_requests_shop_date (shopId, businessDate)
);
