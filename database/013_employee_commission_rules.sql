-- Reglas de comisión por empleado y rubro (ventas POS)

CREATE TABLE IF NOT EXISTS employee_commission_rules (
  id CHAR(36) PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  employeeId CHAR(36) NOT NULL,
  category VARCHAR(128) NOT NULL,
  ratePercent DECIMAL(8,4) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_comm_rule_emp_cat (shopId, employeeId, category),
  KEY idx_comm_rule_shop_emp (shopId, employeeId)
);
