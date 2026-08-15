-- Número de mesa en reservas (opcional).
ALTER TABLE reservations
  ADD COLUMN tableNumber VARCHAR(20) NULL;

-- Textos de email customizables por tipo (JSON: { type: { subject, body } }).
ALTER TABLE shops
  ADD COLUMN emailMessageTemplates TEXT NULL;
