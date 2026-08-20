-- Menú lateral configurable por local
ALTER TABLE shops
  ADD COLUMN navConfig JSON NULL;
