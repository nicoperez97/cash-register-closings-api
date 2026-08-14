-- Regla de personas adentro/afuera por día (NULL = hereda del local).
ALTER TABLE reservation_day_notices
  ADD COLUMN insideMaxPartySize INT NULL,
  ADD COLUMN outsideMinPartySize INT NULL;
