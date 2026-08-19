ALTER TABLE shops
  ADD COLUMN serviceAttendanceWithHours TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE employees
  ADD COLUMN serviceCheckIn VARCHAR(5) NULL;

ALTER TABLE employees
  ADD COLUMN serviceCheckOut VARCHAR(5) NULL;
