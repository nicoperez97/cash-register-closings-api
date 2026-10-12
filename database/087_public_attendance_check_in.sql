-- Kiosco público de fichaje por PIN (anti-documento).
ALTER TABLE shops
  ADD COLUMN publicAttendanceCheckInEnabled TINYINT(1) NOT NULL DEFAULT 0;
