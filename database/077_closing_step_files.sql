CREATE TABLE IF NOT EXISTS closing_step_files (
  id CHAR(36) NOT NULL PRIMARY KEY,
  closingId CHAR(36) NOT NULL,
  slot VARCHAR(24) NOT NULL,
  sourceId VARCHAR(36) NULL,
  filePath VARCHAR(500) NOT NULL,
  fileName VARCHAR(255) NOT NULL,
  fileMime VARCHAR(120) NULL,
  parsedAmount DECIMAL(12,2) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY IDX_closing_step_files_closing (closingId),
  CONSTRAINT fk_csf_closing FOREIGN KEY (closingId) REFERENCES cash_closings(id) ON DELETE CASCADE
);
