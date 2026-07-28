USE cash_register_closings;

ALTER TABLE shops
  ADD COLUMN accentColor VARCHAR(16) NULL AFTER logoUrl;

UPDATE shops SET accentColor = '#E65100' WHERE slug = 'al-panino' AND (accentColor IS NULL OR accentColor = '');
UPDATE shops SET accentColor = '#00897B' WHERE slug = 'tutto-passa' AND (accentColor IS NULL OR accentColor = '');
