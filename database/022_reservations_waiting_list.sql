-- Reservas y lista de espera por local.
CREATE TABLE IF NOT EXISTS reservations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  businessDate DATE NOT NULL,
  guestName VARCHAR(120) NOT NULL DEFAULT '',
  partySize INT NOT NULL DEFAULT 2,
  area VARCHAR(16) NOT NULL DEFAULT 'INSIDE',
  notes VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CONFIRMED',
  reservationTime VARCHAR(5) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX IDX_reservations_shop_date (shopId, businessDate),
  INDEX IDX_reservations_shop_active (shopId, active)
);

CREATE TABLE IF NOT EXISTS waiting_list_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  guestName VARCHAR(120) NOT NULL,
  partySize INT NOT NULL DEFAULT 2,
  phone VARCHAR(40) NOT NULL,
  notes VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'WAITING',
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX IDX_waiting_list_shop_status (shopId, status, active),
  INDEX IDX_waiting_list_shop_created (shopId, createdAt)
);
