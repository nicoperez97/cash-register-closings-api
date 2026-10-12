-- PIN recuperable para admin (auth sigue usando waiterPinHash).
ALTER TABLE employees
  ADD COLUMN waiterPinClear VARCHAR(6) NULL;
