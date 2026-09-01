-- Tipo por turno + flag de presentismo en empleados.
ALTER TABLE employees
  ADD COLUMN shiftAssignments TEXT NULL;

ALTER TABLE employees
  ADD COLUMN countsForAttendanceBonus TINYINT NOT NULL DEFAULT 1;
