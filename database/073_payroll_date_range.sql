-- Liquidación por rango de fechas (además de year/month legacy para SAC).

ALTER TABLE payroll_periods
  ADD COLUMN fromDate DATE NULL;

ALTER TABLE payroll_periods
  ADD COLUMN toDate DATE NULL;

UPDATE payroll_periods
SET
  fromDate = DATE(CONCAT(year, '-', LPAD(month, 2, '0'), '-01')),
  toDate = LAST_DAY(DATE(CONCAT(year, '-', LPAD(month, 2, '0'), '-01')))
WHERE fromDate IS NULL OR toDate IS NULL;
