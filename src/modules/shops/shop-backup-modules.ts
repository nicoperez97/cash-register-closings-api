/** Catálogo de módulos de dump/reset de un local (super admin). */

export type BackupModuleId =
  | 'catalog'
  | 'closings'
  | 'movements'
  | 'expenses'
  | 'incomes'
  | 'posMenu'
  | 'posSales'
  | 'staff'
  | 'attendance'
  | 'payroll';

export type BackupSheetName =
  | 'ledger_accounts'
  | 'ledger_account_users'
  | 'concepts'
  | 'pos_categories'
  | 'pos_subcategories'
  | 'pos_products'
  | 'employees'
  | 'employee_commission_rules'
  | 'attendance_days'
  | 'payroll_periods'
  | 'payroll_lines'
  | 'cash_closings'
  | 'closing_expenses'
  | 'closing_extra_lines'
  | 'movements'
  | 'pos_sale_imports'
  | 'pos_sale_tickets'
  | 'pos_sale_ticket_lines'
  | 'pos_sale_dailies';

export type BackupPurgeStep =
  | 'pos_sale_ticket_lines'
  | 'pos_sale_tickets'
  | 'pos_sale_dailies'
  | 'pos_sale_imports'
  | 'payroll_lines'
  | 'payroll_periods'
  | 'attendance_days'
  | 'employee_commission_rules'
  | 'movements'
  | 'expenses'
  | 'incomes'
  | 'closing_expenses'
  | 'closing_extra_lines'
  | 'cash_closings'
  | 'ledger_account_users'
  | 'pos_products'
  | 'pos_subcategories'
  | 'pos_categories'
  | 'concepts'
  | 'ledger_accounts'
  | 'employees';

export interface BackupModuleDef {
  id: BackupModuleId;
  label: string;
  sheets: BackupSheetName[];
  purgeSteps: BackupPurgeStep[];
  /** Al resetear/exportar con deps, también se incluyen estos módulos. */
  alsoClears: BackupModuleId[];
}

export const BACKUP_MODULES: BackupModuleDef[] = [
  {
    id: 'catalog',
    label: 'Cuentas y conceptos',
    sheets: ['ledger_accounts', 'ledger_account_users', 'concepts'],
    purgeSteps: ['ledger_account_users', 'concepts', 'ledger_accounts'],
    alsoClears: ['movements', 'expenses', 'incomes', 'closings'],
  },
  {
    id: 'closings',
    label: 'Cierres',
    sheets: ['cash_closings', 'closing_expenses', 'closing_extra_lines'],
    purgeSteps: ['closing_expenses', 'closing_extra_lines', 'cash_closings'],
    alsoClears: [],
  },
  {
    id: 'movements',
    label: 'Movimientos',
    sheets: ['movements'],
    purgeSteps: ['movements'],
    alsoClears: [],
  },
  {
    id: 'expenses',
    label: 'Gastos',
    sheets: ['movements'],
    purgeSteps: ['expenses'],
    alsoClears: [],
  },
  {
    id: 'incomes',
    label: 'Ingresos',
    sheets: ['movements'],
    purgeSteps: ['incomes'],
    alsoClears: [],
  },
  {
    id: 'posMenu',
    label: 'Carta POS',
    sheets: ['pos_categories', 'pos_subcategories', 'pos_products'],
    purgeSteps: ['pos_products', 'pos_subcategories', 'pos_categories'],
    alsoClears: ['posSales'],
  },
  {
    id: 'posSales',
    label: 'Ventas POS',
    sheets: [
      'pos_sale_imports',
      'pos_sale_tickets',
      'pos_sale_ticket_lines',
      'pos_sale_dailies',
    ],
    purgeSteps: [
      'pos_sale_ticket_lines',
      'pos_sale_tickets',
      'pos_sale_dailies',
      'pos_sale_imports',
    ],
    alsoClears: [],
  },
  {
    id: 'staff',
    label: 'Empleados',
    sheets: ['employees', 'employee_commission_rules'],
    purgeSteps: ['employee_commission_rules', 'employees'],
    alsoClears: ['attendance', 'payroll'],
  },
  {
    id: 'attendance',
    label: 'Presentismo',
    sheets: ['attendance_days'],
    purgeSteps: ['attendance_days'],
    alsoClears: [],
  },
  {
    id: 'payroll',
    label: 'Nómina',
    sheets: ['payroll_periods', 'payroll_lines'],
    purgeSteps: ['payroll_lines', 'payroll_periods'],
    alsoClears: [],
  },
];

/** Orden global de DELETE (FK-safe). */
export const PURGE_STEP_ORDER: BackupPurgeStep[] = [
  'pos_sale_ticket_lines',
  'pos_sale_tickets',
  'pos_sale_dailies',
  'pos_sale_imports',
  'payroll_lines',
  'payroll_periods',
  'attendance_days',
  'employee_commission_rules',
  'movements',
  'expenses',
  'incomes',
  'closing_expenses',
  'closing_extra_lines',
  'cash_closings',
  'ledger_account_users',
  'pos_products',
  'pos_subcategories',
  'pos_categories',
  'concepts',
  'ledger_accounts',
  'employees',
];

const MODULE_BY_ID = new Map(BACKUP_MODULES.map((m) => [m.id, m]));

export function isBackupModuleId(v: string): v is BackupModuleId {
  return MODULE_BY_ID.has(v as BackupModuleId);
}

/** Parsea `all` o lista comma-separated. Vacío → all. */
export function parseBackupModulesParam(raw?: string | string[] | null): BackupModuleId[] | 'all' {
  if (raw == null || raw === '') return 'all';
  const parts = (Array.isArray(raw) ? raw.join(',') : raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length || parts.includes('all')) return 'all';
  const ids: BackupModuleId[] = [];
  for (const p of parts) {
    if (!isBackupModuleId(p)) {
      throw new Error(`Módulo de backup inválido: ${p}`);
    }
    if (!ids.includes(p)) ids.push(p);
  }
  return ids.length ? ids : 'all';
}

/** Expande alsoClears (transitivo). */
export function expandBackupModules(selected: BackupModuleId[] | 'all'): BackupModuleId[] {
  if (selected === 'all') return BACKUP_MODULES.map((m) => m.id);
  const out = new Set<BackupModuleId>(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...out]) {
      const def = MODULE_BY_ID.get(id);
      if (!def) continue;
      for (const dep of def.alsoClears) {
        if (!out.has(dep)) {
          out.add(dep);
          changed = true;
        }
      }
    }
  }
  return BACKUP_MODULES.map((m) => m.id).filter((id) => out.has(id));
}

export function sheetsForModules(modules: BackupModuleId[] | 'all'): Set<BackupSheetName> {
  const ids = expandBackupModules(modules);
  const sheets = new Set<BackupSheetName>();
  for (const id of ids) {
    const def = MODULE_BY_ID.get(id);
    if (!def) continue;
    for (const s of def.sheets) sheets.add(s);
  }
  return sheets;
}

export function purgeStepsForModules(modules: BackupModuleId[] | 'all'): BackupPurgeStep[] {
  const ids = expandBackupModules(modules);
  const wanted = new Set<BackupPurgeStep>();
  for (const id of ids) {
    const def = MODULE_BY_ID.get(id);
    if (!def) continue;
    for (const s of def.purgeSteps) wanted.add(s);
  }
  return PURGE_STEP_ORDER.filter((s) => wanted.has(s));
}

export function modulesLabelList(modules: BackupModuleId[] | 'all'): string {
  if (modules === 'all') return 'all';
  return expandBackupModules(modules).join(',');
}

export type BackupMovementSlice = 'transfer' | 'expense' | 'income';

export function movementSlicesForModules(
  modules: BackupModuleId[] | 'all',
): Set<BackupMovementSlice> {
  const ids = expandBackupModules(modules);
  const out = new Set<BackupMovementSlice>();
  if (ids.includes('movements')) out.add('transfer');
  if (ids.includes('expenses')) out.add('expense');
  if (ids.includes('incomes')) out.add('income');
  return out;
}

export function classifyBackupMovement(row: {
  conceptKind?: string | null;
  fromAccountName?: string | null;
  fromAccountCode?: string | null;
  toAccountName?: string | null;
  toAccountCode?: string | null;
}): BackupMovementSlice {
  const kind = String(row.conceptKind ?? '');
  const toName = String(row.toAccountName ?? '').toLowerCase();
  const toCode = String(row.toAccountCode ?? '').toUpperCase();
  const fromName = String(row.fromAccountName ?? '').toLowerCase();
  const fromCode = String(row.fromAccountCode ?? '').toUpperCase();
  if (kind === 'EXPENSE' || toCode === 'EGRESO' || toName.includes('egreso')) {
    return 'expense';
  }
  if (kind === 'INCOME' || fromCode === 'INGRESO' || fromName.includes('ingreso')) {
    return 'income';
  }
  return 'transfer';
}
