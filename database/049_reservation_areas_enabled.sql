ALTER TABLE shops
  ADD COLUMN reservationInsideEnabled TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE shops
  ADD COLUMN reservationOutsideEnabled TINYINT(1) NOT NULL DEFAULT 1;
