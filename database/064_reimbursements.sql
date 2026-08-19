ALTER TABLE employees
  ADD COLUMN bankAlias VARCHAR(120) NULL;

CREATE TABLE IF NOT EXISTS reimbursements (
  id CHAR(36) NOT NULL PRIMARY KEY,
  shopId CHAR(36) NOT NULL,
  employeeId CHAR(36) NOT NULL,
  createdByUserId CHAR(36) NULL,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  expenseDate DATE NOT NULL,
  notes VARCHAR(500) NULL,
  bankAliasSnapshot VARCHAR(120) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  paidAt DATE NULL,
  paidByUserId CHAR(36) NULL,
  receiptFilePath VARCHAR(500) NULL,
  receiptFileName VARCHAR(255) NULL,
  receiptFileMime VARCHAR(120) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NULL,
  deletedAt DATETIME(6) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_reimb_shop (shopId),
  KEY idx_reimb_emp (employeeId),
  KEY idx_reimb_status (status),
  KEY idx_reimb_date (expenseDate)
);
