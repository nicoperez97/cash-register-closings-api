-- Quién aparece en «Mozo a cargo» al abrir mesa (Operación → Comanda).
ALTER TABLE employees
  ADD COLUMN showInComanda TINYINT NOT NULL DEFAULT 0;

-- Migración: quienes ya tenían PIN de mozo o rol Mozo siguen listados.
UPDATE employees
SET showInComanda = 1
WHERE deletedAt IS NULL
  AND (
    waiterPinHash IS NOT NULL
    OR jobRoles LIKE '%WAITER%'
  );
