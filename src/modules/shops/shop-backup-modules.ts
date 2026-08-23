/** Catálogo de módulos de dump/reset de un local (super admin). */

export type BackupModuleGroup =
  | 'config'
  | 'operacion'
  | 'cuentas'
  | 'salon'
  | 'stock'
  | 'personal'
  | 'pagos'
  | 'pos';

export type BackupModuleId =
  | 'catalog'
  | 'concepts'
  | 'closings'
  | 'cashWithdrawals'
  | 'settlements'
  | 'movements'
  | 'expenses'
  | 'incomes'
  | 'partnerSplits'
  | 'paymentsSuppliers'
  | 'paymentsServices'
  | 'paymentsEmployees'
  | 'suppliers'
  | 'services'
  | 'posMenu'
  | 'posSales'
  | 'reservations'
  | 'waitingList'
  | 'salon'
  | 'stock'
  | 'beverageStock'
  | 'shortages'
  | 'orders'
  | 'staff'
  | 'candidates'
  | 'commissions'
  | 'attendance'
  | 'productionAttendance'
  | 'payroll'
  | 'tips'
  | 'reimbursements'
  | 'serviceRules';

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
  | 'production_attendance_days'
  | 'payroll_periods'
  | 'payroll_lines'
  | 'cash_closings'
  | 'closing_expenses'
  | 'closing_extra_lines'
  | 'closing_source_amounts'
  | 'shop_closing_sources'
  | 'cash_pending_withdrawals'
  | 'cash_pending_withdrawal_offsets'
  | 'movements'
  | 'payments'
  | 'partner_split_configs'
  | 'suppliers'
  | 'services'
  | 'reservations'
  | 'reservation_requests'
  | 'reservation_day_notices'
  | 'waiting_list_entries'
  | 'salon_tables'
  | 'salon_area_rules'
  | 'stock_categories'
  | 'stock_products'
  | 'shortages'
  | 'orders'
  | 'order_lines'
  | 'candidates'
  | 'tip_days'
  | 'tip_allocations'
  | 'reimbursements'
  | 'service_rule_categories'
  | 'service_rules'
  | 'pos_sale_imports'
  | 'pos_sale_tickets'
  | 'pos_sale_ticket_lines'
  | 'pos_sale_dailies';

export type BackupPurgeStep =
  | 'tip_allocations'
  | 'tip_days'
  | 'order_lines'
  | 'orders'
  | 'shortages'
  | 'stock_products_food'
  | 'stock_products_beverage'
  | 'stock_categories_food'
  | 'stock_categories_beverage'
  | 'waiting_list_entries'
  | 'reservation_requests'
  | 'reservations'
  | 'reservation_day_notices'
  | 'salon_tables'
  | 'salon_area_rules'
  | 'service_rules'
  | 'service_rule_categories'
  | 'reimbursements'
  | 'production_attendance_days'
  | 'candidates'
  | 'cash_pending_withdrawal_offsets'
  | 'cash_pending_withdrawals'
  | 'closing_source_amounts'
  | 'settlement_fields'
  | 'shop_closing_sources'
  | 'partner_split_configs'
  | 'payments_suppliers'
  | 'payments_services'
  | 'payments_employees'
  | 'payments'
  | 'suppliers'
  | 'services'
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
  group: BackupModuleGroup;
  sheets: BackupSheetName[];
  purgeSteps: BackupPurgeStep[];
  alsoClears: BackupModuleId[];
}

export const BACKUP_MODULE_GROUPS: Array<{ id: BackupModuleGroup; label: string }> = [
  { id: 'operacion', label: 'Operación' },
  { id: 'cuentas', label: 'Cuentas y movimientos' },
  { id: 'pagos', label: 'Pagos' },
  { id: 'salon', label: 'Salón' },
  { id: 'stock', label: 'Stock' },
  { id: 'personal', label: 'Personal' },
  { id: 'pos', label: 'POS' },
  { id: 'config', label: 'Configuración' },
];

export const BACKUP_MODULES: BackupModuleDef[] = [
  {
    id: 'closings',
    label: 'Cierres',
    group: 'operacion',
    sheets: [
      'cash_closings',
      'closing_expenses',
      'closing_extra_lines',
      'closing_source_amounts',
      'shop_closing_sources',
    ],
    purgeSteps: [
      'closing_source_amounts',
      'closing_expenses',
      'closing_extra_lines',
      'cash_closings',
      'shop_closing_sources',
    ],
    alsoClears: ['cashWithdrawals', 'settlements'],
  },
  {
    id: 'cashWithdrawals',
    label: 'A Retirar',
    group: 'operacion',
    sheets: ['cash_pending_withdrawals', 'cash_pending_withdrawal_offsets'],
    purgeSteps: ['cash_pending_withdrawal_offsets', 'cash_pending_withdrawals'],
    alsoClears: [],
  },
  {
    id: 'settlements',
    label: 'Rendiciones',
    group: 'operacion',
    sheets: ['closing_source_amounts'],
    purgeSteps: ['settlement_fields'],
    alsoClears: [],
  },
  {
    id: 'tips',
    label: 'Propinas',
    group: 'operacion',
    sheets: ['tip_days', 'tip_allocations'],
    purgeSteps: ['tip_allocations', 'tip_days'],
    alsoClears: [],
  },
  {
    id: 'serviceRules',
    label: 'Normas de servicio',
    group: 'operacion',
    sheets: ['service_rule_categories', 'service_rules'],
    purgeSteps: ['service_rules', 'service_rule_categories'],
    alsoClears: [],
  },
  {
    id: 'expenses',
    label: 'Gastos',
    group: 'cuentas',
    sheets: ['movements'],
    purgeSteps: ['expenses'],
    alsoClears: [],
  },
  {
    id: 'incomes',
    label: 'Ingresos',
    group: 'cuentas',
    sheets: ['movements'],
    purgeSteps: ['incomes'],
    alsoClears: [],
  },
  {
    id: 'movements',
    label: 'Movimientos entre cuentas',
    group: 'cuentas',
    sheets: ['movements'],
    purgeSteps: ['movements'],
    alsoClears: [],
  },
  {
    id: 'partnerSplits',
    label: 'División de socios',
    group: 'cuentas',
    sheets: ['partner_split_configs'],
    purgeSteps: ['partner_split_configs'],
    alsoClears: [],
  },
  {
    id: 'paymentsSuppliers',
    label: 'Pagos a proveedores',
    group: 'pagos',
    sheets: ['payments'],
    purgeSteps: ['payments_suppliers'],
    alsoClears: [],
  },
  {
    id: 'paymentsServices',
    label: 'Pagos a servicios',
    group: 'pagos',
    sheets: ['payments'],
    purgeSteps: ['payments_services'],
    alsoClears: [],
  },
  {
    id: 'paymentsEmployees',
    label: 'Pagos a empleados',
    group: 'pagos',
    sheets: ['payments'],
    purgeSteps: ['payments_employees'],
    alsoClears: [],
  },
  {
    id: 'suppliers',
    label: 'Proveedores',
    group: 'pagos',
    sheets: ['suppliers'],
    purgeSteps: ['suppliers'],
    alsoClears: ['paymentsSuppliers'],
  },
  {
    id: 'services',
    label: 'Servicios',
    group: 'pagos',
    sheets: ['services'],
    purgeSteps: ['services'],
    alsoClears: ['paymentsServices'],
  },
  {
    id: 'reservations',
    label: 'Reservas',
    group: 'salon',
    sheets: ['reservations', 'reservation_requests', 'reservation_day_notices'],
    purgeSteps: ['reservation_requests', 'reservations', 'reservation_day_notices'],
    alsoClears: [],
  },
  {
    id: 'waitingList',
    label: 'Lista de espera',
    group: 'salon',
    sheets: ['waiting_list_entries'],
    purgeSteps: ['waiting_list_entries'],
    alsoClears: [],
  },
  {
    id: 'salon',
    label: 'Salón',
    group: 'salon',
    sheets: ['salon_tables', 'salon_area_rules'],
    purgeSteps: ['salon_tables', 'salon_area_rules'],
    alsoClears: [],
  },
  {
    id: 'stock',
    label: 'Stock alimentos',
    group: 'stock',
    sheets: ['stock_categories', 'stock_products'],
    purgeSteps: ['stock_products_food', 'stock_categories_food'],
    alsoClears: [],
  },
  {
    id: 'beverageStock',
    label: 'Stock bebidas',
    group: 'stock',
    sheets: ['stock_categories', 'stock_products'],
    purgeSteps: ['stock_products_beverage', 'stock_categories_beverage'],
    alsoClears: [],
  },
  {
    id: 'shortages',
    label: 'Faltantes',
    group: 'stock',
    sheets: ['shortages'],
    purgeSteps: ['shortages'],
    alsoClears: [],
  },
  {
    id: 'orders',
    label: 'Pedidos',
    group: 'stock',
    sheets: ['orders', 'order_lines'],
    purgeSteps: ['order_lines', 'orders'],
    alsoClears: [],
  },
  {
    id: 'staff',
    label: 'Empleados',
    group: 'personal',
    sheets: ['employees'],
    purgeSteps: ['employees'],
    alsoClears: [
      'attendance',
      'productionAttendance',
      'payroll',
      'commissions',
      'reimbursements',
      'tips',
      'paymentsEmployees',
    ],
  },
  {
    id: 'candidates',
    label: 'CVs / Candidatos',
    group: 'personal',
    sheets: ['candidates'],
    purgeSteps: ['candidates'],
    alsoClears: [],
  },
  {
    id: 'payroll',
    label: 'Liquidaciones',
    group: 'personal',
    sheets: ['payroll_periods', 'payroll_lines'],
    purgeSteps: ['payroll_lines', 'payroll_periods'],
    alsoClears: [],
  },
  {
    id: 'commissions',
    label: 'Comisiones',
    group: 'personal',
    sheets: ['employee_commission_rules'],
    purgeSteps: ['employee_commission_rules'],
    alsoClears: [],
  },
  {
    id: 'attendance',
    label: 'Asistencia servicio',
    group: 'personal',
    sheets: ['attendance_days'],
    purgeSteps: ['attendance_days'],
    alsoClears: [],
  },
  {
    id: 'productionAttendance',
    label: 'Asistencia producción',
    group: 'personal',
    sheets: ['production_attendance_days'],
    purgeSteps: ['production_attendance_days'],
    alsoClears: [],
  },
  {
    id: 'reimbursements',
    label: 'Reintegros',
    group: 'personal',
    sheets: ['reimbursements'],
    purgeSteps: ['reimbursements'],
    alsoClears: [],
  },
  {
    id: 'posMenu',
    label: 'Carta POS',
    group: 'pos',
    sheets: ['pos_categories', 'pos_subcategories', 'pos_products'],
    purgeSteps: ['pos_products', 'pos_subcategories', 'pos_categories'],
    alsoClears: ['posSales'],
  },
  {
    id: 'posSales',
    label: 'Ventas POS',
    group: 'pos',
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
    id: 'catalog',
    label: 'Cuentas',
    group: 'config',
    sheets: ['ledger_accounts', 'ledger_account_users'],
    purgeSteps: ['ledger_account_users', 'ledger_accounts'],
    alsoClears: [
      'movements',
      'expenses',
      'incomes',
      'paymentsSuppliers',
      'paymentsServices',
      'paymentsEmployees',
      'suppliers',
      'services',
      'partnerSplits',
      'cashWithdrawals',
    ],
  },
  {
    id: 'concepts',
    label: 'Conceptos',
    group: 'config',
    sheets: ['concepts'],
    purgeSteps: ['concepts'],
    alsoClears: [
      'movements',
      'expenses',
      'incomes',
      'paymentsSuppliers',
      'paymentsServices',
      'paymentsEmployees',
    ],
  },
];

export const PURGE_STEP_ORDER: BackupPurgeStep[] = [
  'tip_allocations',
  'tip_days',
  'order_lines',
  'orders',
  'shortages',
  'stock_products_food',
  'stock_products_beverage',
  'stock_categories_food',
  'stock_categories_beverage',
  'waiting_list_entries',
  'reservation_requests',
  'reservations',
  'reservation_day_notices',
  'salon_tables',
  'salon_area_rules',
  'service_rules',
  'service_rule_categories',
  'reimbursements',
  'production_attendance_days',
  'candidates',
  'cash_pending_withdrawal_offsets',
  'cash_pending_withdrawals',
  'pos_sale_ticket_lines',
  'pos_sale_tickets',
  'pos_sale_dailies',
  'pos_sale_imports',
  'payroll_lines',
  'payroll_periods',
  'attendance_days',
  'employee_commission_rules',
  'payments_suppliers',
  'payments_services',
  'payments_employees',
  'payments',
  'partner_split_configs',
  'settlement_fields',
  'closing_source_amounts',
  'movements',
  'expenses',
  'incomes',
  'closing_expenses',
  'closing_extra_lines',
  'cash_closings',
  'shop_closing_sources',
  'suppliers',
  'services',
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
  const add = (id: BackupModuleId) => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const p of parts) {
    if (p === 'payments') {
      add('paymentsSuppliers');
      add('paymentsServices');
      add('paymentsEmployees');
      continue;
    }
    if (!isBackupModuleId(p)) {
      throw new Error(`Módulo de backup inválido: ${p}`);
    }
    add(p);
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
