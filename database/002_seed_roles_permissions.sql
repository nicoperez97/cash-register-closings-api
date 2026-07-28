USE cash_register_closings;

INSERT INTO permissions (id, code, description) VALUES
  (UUID(), 'closings.create', 'Crear cierres'),
  (UUID(), 'closings.read', 'Ver cierres'),
  (UUID(), 'closings.update', 'Editar cierres'),
  (UUID(), 'closings.lock', 'Bloquear cierres'),
  (UUID(), 'reports.view', 'Ver reportes'),
  (UUID(), 'reports.export', 'Exportar Excel'),
  (UUID(), 'shops.manage', 'Administrar locales'),
  (UUID(), 'users.manage', 'Administrar usuarios')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role, permissionCode) VALUES
  ('OWNER','closings.create'),('OWNER','closings.read'),('OWNER','closings.update'),('OWNER','closings.lock'),
  ('OWNER','reports.view'),('OWNER','reports.export'),('OWNER','shops.manage'),('OWNER','users.manage'),
  ('ADMIN','closings.create'),('ADMIN','closings.read'),('ADMIN','closings.update'),('ADMIN','closings.lock'),
  ('ADMIN','reports.view'),('ADMIN','reports.export'),('ADMIN','shops.manage'),('ADMIN','users.manage'),
  ('MANAGER','closings.create'),('MANAGER','closings.read'),('MANAGER','closings.update'),('MANAGER','closings.lock'),
  ('MANAGER','reports.view'),('MANAGER','reports.export'),('MANAGER','shops.manage'),
  ('CASHIER','closings.create'),
  ('VIEWER','closings.read'),('VIEWER','reports.view'),('VIEWER','reports.export')
ON DUPLICATE KEY UPDATE permissionCode = VALUES(permissionCode);
