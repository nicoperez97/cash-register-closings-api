-- Config de presentismo por liquidación (monto + umbral de días).
ALTER TABLE payroll_periods
  ADD COLUMN attendanceBonusAmount DECIMAL(14,2) NOT NULL DEFAULT 50000;

ALTER TABLE payroll_periods
  ADD COLUMN attendanceBonusMinDays INT NOT NULL DEFAULT 21;
