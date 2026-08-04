-- Produce comida (empleados) + horas default de producción (local) + presentismo de producción.
ALTER TABLE employees
  ADD COLUMN producesFood TINYINT(1) NOT NULL DEFAULT 0
  AFTER type;

ALTER TABLE shops
  ADD COLUMN productionDefaultHours DECIMAL(6,2) NOT NULL DEFAULT 8.00
  AFTER defaultChangeAmount;

CREATE TABLE IF NOT EXISTS production_attendance_days (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  employeeId CHAR(36) NOT NULL,
  date DATE NOT NULL,
  hours DECIMAL(6,2) NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_prod_att_emp_date (employeeId, date),
  KEY idx_prod_att_shop_date (shopId, date),
  KEY idx_prod_att_employee (employeeId)
);
