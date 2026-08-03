-- Habilitación por local de reservas y lista de espera
ALTER TABLE shops
  ADD COLUMN reservationsEnabled TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE shops
  ADD COLUMN waitingListEnabled TINYINT(1) NOT NULL DEFAULT 1;
