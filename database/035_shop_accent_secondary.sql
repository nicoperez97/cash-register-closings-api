-- Segundo color de marca del local (énfasis).
ALTER TABLE shops
  ADD COLUMN accentSecondary VARCHAR(16) NULL AFTER accentColor;
