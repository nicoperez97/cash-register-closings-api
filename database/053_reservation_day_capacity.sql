-- Cupo restante de personas por sector para el día (NULL = sin límite).
ALTER TABLE reservation_day_notices
  ADD COLUMN insideCapacityRemaining INT NULL,
  ADD COLUMN outsideCapacityRemaining INT NULL;
