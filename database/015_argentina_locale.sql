-- Localización Argentina: moneda ARS y timezone Buenos Aires.
UPDATE shops
SET
  timezone = 'America/Argentina/Buenos_Aires',
  currency = 'ARS'
WHERE timezone IN ('America/Montevideo', 'UTC')
   OR currency IN ('UYU', 'usd', 'USD');

ALTER TABLE shops
  MODIFY timezone VARCHAR(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  MODIFY currency VARCHAR(8) NOT NULL DEFAULT 'ARS';
