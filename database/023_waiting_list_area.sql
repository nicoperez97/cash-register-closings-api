-- Área adentro/afuera en lista de espera (default INSIDE).
ALTER TABLE waiting_list_entries
  ADD COLUMN area VARCHAR(16) NOT NULL DEFAULT 'INSIDE';
