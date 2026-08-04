-- Tipo de empleado: fijo (entra en "Todos presentes") o rotativo (solo marcado manual).
ALTER TABLE employees
  ADD COLUMN type ENUM('FIXED', 'ROTATING') NOT NULL DEFAULT 'FIXED'
  AFTER notes;
