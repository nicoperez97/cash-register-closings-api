-- Empleados, presentismo, liquidación y libro de movimientos
-- TypeORM synchronize=true también crea estas tablas desde entidades.

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(64) NOT NULL,
  type ENUM('PARTNER','CHANNEL','SYSTEM') NOT NULL DEFAULT 'PARTNER',
  linkedPaymentMethod VARCHAR(32) NULL,
  userId CHAR(36) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_ledger_shop_code (shopId, code),
  KEY idx_ledger_shop (shopId),
  KEY idx_ledger_user (userId)
);

CREATE TABLE IF NOT EXISTS concepts (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  kind ENUM('INCOME','EXPENSE','TRANSFER') NOT NULL DEFAULT 'EXPENSE',
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_concept_shop_name (shopId, name),
  KEY idx_concept_shop (shopId)
);

CREATE TABLE IF NOT EXISTS employees (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  fullName VARCHAR(255) NOT NULL,
  baseSalary DECIMAL(12,2) NOT NULL DEFAULT 0,
  userId CHAR(36) NULL,
  hireDate DATE NULL,
  notes TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  KEY idx_employee_shop (shopId),
  KEY idx_employee_user (userId)
);

CREATE TABLE IF NOT EXISTS movements (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  businessDate DATE NOT NULL,
  fromAccountId CHAR(36) NOT NULL,
  toAccountId CHAR(36) NOT NULL,
  description VARCHAR(500) NULL,
  amountUyu DECIMAL(14,2) NOT NULL DEFAULT 0,
  usdRate DECIMAL(12,4) NULL,
  amountUsd DECIMAL(14,4) NULL,
  conceptId CHAR(36) NULL,
  invoiced TINYINT NOT NULL DEFAULT 0,
  invoiceNumber VARCHAR(64) NULL,
  closingId CHAR(36) NULL,
  employeeId CHAR(36) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  KEY idx_mov_shop_date (shopId, businessDate),
  KEY idx_mov_closing (closingId),
  KEY idx_mov_concept (conceptId)
);

CREATE TABLE IF NOT EXISTS attendance_days (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  employeeId CHAR(36) NOT NULL,
  date DATE NOT NULL,
  isHoliday TINYINT NOT NULL DEFAULT 0,
  isPresent TINYINT NOT NULL DEFAULT 0,
  overtimeHours DECIMAL(6,2) NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_attendance_emp_date (employeeId, date),
  KEY idx_attendance_shop (shopId, date)
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  status ENUM('DRAFT','LOCKED') NOT NULL DEFAULT 'DRAFT',
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_payroll_period (shopId, year, month)
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id CHAR(36) PRIMARY KEY,
  periodId CHAR(36) NOT NULL,
  employeeId CHAR(36) NOT NULL,
  daysWorked DECIMAL(8,2) NOT NULL DEFAULT 0,
  holidayDays DECIMAL(8,2) NOT NULL DEFAULT 0,
  baseSalarySnapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtimeAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
  attendanceBonus DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_payroll_line (periodId, employeeId)
);

ALTER TABLE cash_closings
  ADD COLUMN IF NOT EXISTS cashWithdrawnByEmployeeId VARCHAR(36) NULL;
