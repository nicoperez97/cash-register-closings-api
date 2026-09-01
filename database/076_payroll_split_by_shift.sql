-- Liquidación opcional por turno.
ALTER TABLE payroll_periods
  ADD COLUMN splitByShift TINYINT NOT NULL DEFAULT 0;

ALTER TABLE payroll_lines
  ADD COLUMN shiftId VARCHAR(36) NOT NULL DEFAULT '';

ALTER TABLE payroll_lines
  ADD COLUMN shiftName VARCHAR(80) NULL;

-- Reemplazar unique (periodId, employeeId) por (periodId, employeeId, shiftId).
ALTER TABLE payroll_lines DROP INDEX IDX_payroll_lines_period_employee;
-- nombres posibles del unique viejo; ignorar error si no existe
-- ALTER TABLE payroll_lines DROP INDEX UQ_... ;

ALTER TABLE payroll_lines
  ADD UNIQUE INDEX uq_payroll_lines_period_emp_shift (periodId, employeeId, shiftId);
