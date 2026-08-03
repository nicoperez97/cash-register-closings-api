-- Hora de apertura del local (día laboral hasta esa hora del día siguiente).
ALTER TABLE shops
  ADD COLUMN openingTime VARCHAR(5) NOT NULL DEFAULT '10:00'
  AFTER timezone;
