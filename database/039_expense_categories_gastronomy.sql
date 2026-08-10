-- Categorías de egreso orientadas a gastronomía (closing_expenses.category)
-- Idempotente: reescribe el ENUM completo con valores nuevos + legacy.

ALTER TABLE closing_expenses
  MODIFY COLUMN category ENUM(
    'VEGETABLES',
    'CHEESE',
    'MEAT',
    'FISH',
    'BAKERY',
    'DELI',
    'GROCERY',
    'DAIRY',
    'BEVERAGES',
    'BAR',
    'COFFEE',
    'SUPPLIES',
    'SERVICES',
    'TRANSFER_SHOP',
    'OTHER',
    'RAW_MATERIALS',
    'DRINKS',
    'SALARIES',
    'RENT',
    'EQUIPMENT',
    'CLEANING',
    'DISPOSABLES',
    'UTILITIES',
    'MARKETING',
    'COMMISSIONS'
  ) NOT NULL DEFAULT 'OTHER';
