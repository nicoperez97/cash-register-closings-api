-- Visibilidad por superficie (JSON). true = se muestra. Migra hideFromCashWithdraw.
ALTER TABLE user_shops
  ADD COLUMN visibility JSON NULL;

UPDATE user_shops
SET visibility = JSON_OBJECT(
  'cashWithdraw', IF(IFNULL(hideFromCashWithdraw, 0) = 0, TRUE, FALSE),
  'closingsFilters', TRUE,
  'payments', TRUE,
  'movements', TRUE,
  'employeeLink', TRUE,
  'usersList', TRUE
)
WHERE visibility IS NULL;
