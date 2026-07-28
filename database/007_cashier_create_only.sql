-- Deja al cajero solo con permiso de crear cierres (si ya corriste el seed anterior).
USE cash_register_closings;

DELETE FROM role_permissions
WHERE role = 'CASHIER' AND permissionCode IN ('closings.read', 'closings.update');
