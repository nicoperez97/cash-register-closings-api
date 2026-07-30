-- Permisos por módulo en membresía usuario–local

ALTER TABLE user_shops
  ADD COLUMN modulePermissions JSON NULL;
