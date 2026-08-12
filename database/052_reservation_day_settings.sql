-- Overrides por día del formulario web de reservas (NULL = hereda config del local).
ALTER TABLE reservation_day_notices
  ADD COLUMN signupEnabled TINYINT(1) NULL,
  ADD COLUMN insideEnabled TINYINT(1) NULL,
  ADD COLUMN outsideEnabled TINYINT(1) NULL;
