-- Sueldo diario, multiplicador feriado e historial de cambios de sueldo.

ALTER TABLE shops
  ADD COLUMN holidayPayMultiplier DECIMAL(4,2) NOT NULL DEFAULT 2.00;

ALTER TABLE shops
  ADD COLUMN dailySalaryConvertedAt DATETIME(6) NULL;

ALTER TABLE employees
  ADD COLUMN holidayPayMultiplier DECIMAL(4,2) NULL;

ALTER TABLE payroll_lines
  ADD COLUMN holidayMultiplierSnapshot DECIMAL(4,2) NULL;

CREATE TABLE IF NOT EXISTS employee_salary_history (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  employeeId CHAR(36) NOT NULL,
  baseSalary DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtimeHourRate DECIMAL(12,2) NOT NULL DEFAULT 0,
  holidayPayMultiplier DECIMAL(4,2) NULL,
  previousBaseSalary DECIMAL(12,2) NULL,
  previousOvertimeHourRate DECIMAL(12,2) NULL,
  previousHolidayPayMultiplier DECIMAL(4,2) NULL,
  note TEXT NULL,
  source ENUM('CREATE', 'UPDATE', 'MIGRATE_DAILY') NOT NULL DEFAULT 'UPDATE',
  createdByUserId CHAR(36) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  KEY idx_salary_hist_shop (shopId),
  KEY idx_salary_hist_employee (employeeId),
  KEY idx_salary_hist_created (createdAt)
);
