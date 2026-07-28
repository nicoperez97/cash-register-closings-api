USE cash_register_closings;

SET @pwd := '$2b$10$CxcHphc00U5wQgcXT.QJxu1gZx6p2QZES4HBbBcT6/cYR6DyJ/7ji';

INSERT INTO shops (id, name, slug, unitsLabel, coversEnabled, defaultChangeAmount, accentColor, active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Al Panino', 'al-panino', 'paninos', 0, 15000.00, '#E65100', 1),
  ('22222222-2222-2222-2222-222222222222', 'Tutto Passa', 'tutto-passa', NULL, 1, 0.00, '#00897B', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), accentColor = COALESCE(shops.accentColor, VALUES(accentColor));


INSERT INTO users (id, fullName, email, passwordHash, globalRole, active) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Cierres', 'admin@cierres.com', @pwd, 'ADMIN', 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Manager Multi', 'manager@cierres.com', @pwd, 'MANAGER', 1),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Cajero Panino', 'cashier@cierres.com', @pwd, 'CASHIER', 1)
ON DUPLICATE KEY UPDATE fullName = VALUES(fullName);

INSERT INTO user_shops (id, userId, shopId) VALUES
  (UUID(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  (UUID(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  (UUID(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111'),
  (UUID(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
  (UUID(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111')
ON DUPLICATE KEY UPDATE shopId = VALUES(shopId);
