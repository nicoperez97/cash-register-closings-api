ALTER TABLE reservation_requests
  ADD COLUMN area VARCHAR(16) NOT NULL DEFAULT 'INSIDE';

ALTER TABLE reservation_requests
  ADD COLUMN guestComment VARCHAR(400) NULL;
