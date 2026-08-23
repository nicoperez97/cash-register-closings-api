import { GlobalRole, Permission, PERMISSIONS, ROLE_PERMISSIONS } from './enums';

/** Claves de módulo en `user_shops.modulePermissions`. */
export type ModuleKey =
  | 'closings'
  | 'cashWithdrawals'
  | 'settlements'
  | 'reports'
  | 'movements'
  | 'expenses'
  | 'accountTransfers'
  | 'partnerSplits'
  | 'incomes'
  | 'attendance'
  | 'employees'
  | 'candidates'
  | 'payroll'
  | 'commissions'
  | 'accounts'
  | 'concepts'
  | 'reservations'
  | 'waitingList'
  | 'payments'
  | 'suppliers'
  | 'services'
  | 'stock'
  | 'beverageStock'
  | 'shortages'
  | 'orders'
  | 'tips'
  | 'reimbursements'
  | 'serviceRules'
  | 'shop'
  | 'users';

export type ModuleLevel = string;

export type ModulePermissionsMap = Partial<Record<ModuleKey, ModuleLevel>>;

export interface ModuleLevelOption {
  value: ModuleLevel;
  label: string;
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  levels: ModuleLevelOption[];
}

export const MODULE_DEFS: ModuleDef[] = [
  {
    key: 'closings',
    label: 'Cierres',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'create', label: 'Solo crear' },
      { value: 'read', label: 'Ver' },
      { value: 'update', label: 'Editar' },
      { value: 'lock', label: 'Bloquear' },
    ],
  },
  {
    key: 'cashWithdrawals',
    label: 'A Retirar',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'settlements',
    label: 'Rendiciones',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'reports',
    label: 'Reportes',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'export', label: 'Exportar' },
    ],
  },
  {
    key: 'expenses',
    label: 'Gastos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'accountTransfers',
    label: 'Movimientos entre cuentas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'partnerSplits',
    label: 'División de socios',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'incomes',
    label: 'Ingresos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'attendance',
    label: 'Asistencia',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'self', label: 'Solo mis horas (producción)' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'employees',
    label: 'Empleados',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'candidates',
    label: 'CVs / Candidatos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'payroll',
    label: 'Liquidaciones',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'commissions',
    label: 'Comisiones',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'accounts',
    label: 'Cuentas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'concepts',
    label: 'Conceptos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'reservations',
    label: 'Reservas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'waitingList',
    label: 'Lista de espera',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'payments',
    label: 'Pagos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'suppliers',
    label: 'Proveedores',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'services',
    label: 'Servicios',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'stock',
    label: 'Stock alimentos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'beverageStock',
    label: 'Stock bebidas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'shortages',
    label: 'Stock faltantes',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'orders',
    label: 'Pedidos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'tips',
    label: 'Propinas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'create', label: 'Cargar' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'reimbursements',
    label: 'Reintegros',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'self', label: 'Solo mis gastos' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar (marcar pagos)' },
    ],
  },
  {
    key: 'serviceRules',
    label: 'Normas de servicio',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'shop',
    label: 'Local / POS',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'users',
    label: 'Usuarios',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
];

const MODULE_KEYS = MODULE_DEFS.map((d) => d.key);

function add(set: Set<Permission>, ...perms: Permission[]) {
  for (const p of perms) set.add(p);
}

/** Expande niveles de módulo → permisos de API existentes. */
export function expandModulePermissions(
  modules: ModulePermissionsMap | null | undefined,
): Permission[] {
  if (!modules || !Object.keys(modules).length) return [];
  const set = new Set<Permission>();

  switch (modules.closings) {
    case 'create':
      add(set, 'closings.create', 'closings.read');
      break;
    case 'read':
      add(set, 'closings.read');
      break;
    case 'update':
      add(set, 'closings.create', 'closings.read', 'closings.update');
      break;
    case 'lock':
      add(set, 'closings.create', 'closings.read', 'closings.update', 'closings.lock');
      break;
  }

  switch (modules.reports) {
    case 'read':
      add(set, 'reports.view');
      break;
    case 'export':
      add(set, 'reports.view', 'reports.export');
      break;
  }

  const pair = (
    key: ModuleKey,
    read: Permission,
    manage: Permission,
  ) => {
    const level = modules[key];
    if (level === 'read') add(set, read);
    if (level === 'manage') add(set, read, manage);
  };

  // Legacy movements → expenses + accountTransfers
  const legacyMov = modules.movements;
  const expensesLevel =
    modules.expenses ||
    (legacyMov === 'read' || legacyMov === 'manage' ? legacyMov : undefined);
  const transfersLevel =
    modules.accountTransfers ||
    (legacyMov === 'read' || legacyMov === 'manage' ? legacyMov : undefined);
  if (expensesLevel === 'read') add(set, 'expenses.read');
  if (expensesLevel === 'manage') add(set, 'expenses.read', 'expenses.manage');
  if (transfersLevel === 'read') add(set, 'accountTransfers.read');
  if (transfersLevel === 'manage') add(set, 'accountTransfers.read', 'accountTransfers.manage');
  const splitLevel = modules.partnerSplits || transfersLevel;
  if (splitLevel === 'read') add(set, 'partnerSplits.read');
  if (splitLevel === 'manage') add(set, 'partnerSplits.read', 'partnerSplits.manage');
  const incomesLevel = modules.incomes || expensesLevel;
  if (incomesLevel === 'read') add(set, 'incomes.read');
  if (incomesLevel === 'manage') add(set, 'incomes.read', 'incomes.manage');
  if (expensesLevel === 'read' || expensesLevel === 'manage' || transfersLevel === 'read' || transfersLevel === 'manage' || incomesLevel === 'read' || incomesLevel === 'manage') {
    add(set, 'movements.read');
    if (expensesLevel === 'manage' || transfersLevel === 'manage' || incomesLevel === 'manage') add(set, 'movements.manage');
  }
  pair('cashWithdrawals', 'cashWithdrawals.read', 'cashWithdrawals.manage');
  pair('settlements', 'settlements.read', 'settlements.manage');
  switch (modules.attendance) {
    case 'self':
      add(set, 'attendance.self');
      break;
    case 'read':
      add(set, 'attendance.read');
      break;
    case 'manage':
      add(set, 'attendance.read', 'attendance.manage');
      break;
  }
  pair('employees', 'employees.read', 'employees.manage');
  pair('candidates', 'candidates.read', 'candidates.manage');
  pair('payroll', 'payroll.read', 'payroll.manage');
  pair('commissions', 'commissions.read', 'commissions.manage');
  pair('reservations', 'reservations.read', 'reservations.manage');
  pair('waitingList', 'waitingList.read', 'waitingList.manage');
  pair('payments', 'payments.read', 'payments.manage');
  pair('suppliers', 'suppliers.read', 'suppliers.manage');
  pair('services', 'services.read', 'services.manage');
  pair('stock', 'stock.read', 'stock.manage');
  pair('beverageStock', 'beverageStock.read', 'beverageStock.manage');
  pair('shortages', 'shortages.read', 'shortages.manage');
  pair('orders', 'orders.read', 'orders.manage');
  switch (modules.tips) {
    case 'read':
      add(set, 'tips.read');
      break;
    case 'create':
      add(set, 'tips.read', 'tips.create');
      break;
    case 'manage':
      add(set, 'tips.read', 'tips.create', 'tips.manage');
      break;
  }
  switch (modules.reimbursements) {
    case 'self':
      add(set, 'reimbursements.self');
      break;
    case 'read':
      add(set, 'reimbursements.read');
      break;
    case 'manage':
      add(set, 'reimbursements.read', 'reimbursements.manage');
      break;
  }
  switch (modules.serviceRules) {
    case 'read':
      add(set, 'serviceRules.read');
      break;
    case 'manage':
      add(set, 'serviceRules.read', 'serviceRules.manage');
      break;
  }
  // Quien gestiona pagos puede elegir / crear proveedores en el formulario.
  if (modules.payments === 'manage') {
    add(set, 'suppliers.read', 'suppliers.manage', 'services.read', 'services.manage');
  }
  if (modules.payments === 'read') add(set, 'suppliers.read', 'services.read');

  if (modules.accounts === 'manage') {
    add(set, 'accounts.manage', 'expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read');
  }
  if (modules.concepts === 'manage') {
    add(set, 'concepts.manage', 'expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read');
  }
  if (modules.shop === 'manage') add(set, 'shops.manage');
  if (modules.users === 'manage') add(set, 'users.manage');

  return [...set];
}

/** Deriva niveles de módulo desde la plantilla de un rol (migración soft). */
export function deriveModulesFromRole(role: GlobalRole): ModulePermissionsMap {
  const perms = new Set(ROLE_PERMISSIONS[role] ?? []);
  const has = (p: Permission) => perms.has(p);

  const closings = (): ModuleLevel => {
    if (has('closings.lock')) return 'lock';
    if (has('closings.update')) return 'update';
    if (has('closings.create')) return 'create';
    if (has('closings.read')) return 'read';
    return 'none';
  };

  const reports = (): ModuleLevel => {
    if (has('reports.export')) return 'export';
    if (has('reports.view')) return 'read';
    return 'none';
  };

  const level = (read: Permission, manage: Permission): ModuleLevel => {
    if (has(manage)) return 'manage';
    if (has(read)) return 'read';
    return 'none';
  };

  const attendance = (): ModuleLevel => {
    if (has('attendance.manage')) return 'manage';
    if (has('attendance.read')) return 'read';
    if (has('attendance.self')) return 'self';
    return 'none';
  };

  return {
    closings: closings(),
    cashWithdrawals: level('cashWithdrawals.read', 'cashWithdrawals.manage'),
    settlements: level('settlements.read', 'settlements.manage'),
    reports: reports(),
    expenses: level('expenses.read', 'expenses.manage'),
    accountTransfers: level('accountTransfers.read', 'accountTransfers.manage'),
    partnerSplits: level('partnerSplits.read', 'partnerSplits.manage'),
    incomes: level('incomes.read', 'incomes.manage'),
    attendance: attendance(),
    employees: level('employees.read', 'employees.manage'),
    candidates: level('candidates.read', 'candidates.manage'),
    payroll: level('payroll.read', 'payroll.manage'),
    commissions: level('commissions.read', 'commissions.manage'),
    reservations: level('reservations.read', 'reservations.manage'),
    waitingList: level('waitingList.read', 'waitingList.manage'),
    payments: level('payments.read', 'payments.manage'),
    suppliers: level('suppliers.read', 'suppliers.manage'),
    services: level('services.read', 'services.manage'),
    stock: level('stock.read', 'stock.manage'),
    beverageStock: level('beverageStock.read', 'beverageStock.manage'),
    shortages: level('shortages.read', 'shortages.manage'),
    orders: level('orders.read', 'orders.manage'),
    tips: (() => {
      if (has('tips.manage')) return 'manage';
      if (has('tips.create')) return 'create';
      if (has('tips.read')) return 'read';
      return 'none';
    })(),
    reimbursements: (() => {
      if (has('reimbursements.manage')) return 'manage';
      if (has('reimbursements.read')) return 'read';
      if (has('reimbursements.self')) return 'self';
      return 'none';
    })(),
    serviceRules: level('serviceRules.read', 'serviceRules.manage'),
    accounts: has('accounts.manage') ? 'manage' : 'none',
    concepts: has('concepts.manage') ? 'manage' : 'none',
    shop: has('shops.manage') ? 'manage' : 'none',
    users: has('users.manage') ? 'manage' : 'none',
  };
}

/** Normaliza mapa: solo keys conocidas; default none omitido. */
export function sanitizeModulePermissions(
  input: Record<string, string> | null | undefined,
  opts?: { allowUsersModule?: boolean },
): ModulePermissionsMap {
  if (!input) return {};
  const allowUsers = opts?.allowUsersModule ?? false;
  const rawInput = { ...input };
  // Migración soft: movements → expenses + accountTransfers
  const legacy = rawInput.movements;
  if (legacy && legacy !== 'none') {
    if (!rawInput.expenses || rawInput.expenses === 'none') rawInput.expenses = legacy;
    if (!rawInput.accountTransfers || rawInput.accountTransfers === 'none') {
      rawInput.accountTransfers = legacy;
    }
    delete rawInput.movements;
  }
  if (rawInput.expenses && rawInput.expenses !== 'none' && (!rawInput.incomes || rawInput.incomes === 'none')) {
    rawInput.incomes = rawInput.expenses;
  }
  if (!rawInput.orders || rawInput.orders === 'none') {
    const fromStock = [rawInput.stock, rawInput.beverageStock, rawInput.shortages];
    if (fromStock.includes('manage')) rawInput.orders = 'manage';
    else if (fromStock.includes('read')) rawInput.orders = 'read';
  }
  const out: ModulePermissionsMap = {};
  for (const def of MODULE_DEFS) {
    if (def.key === 'users' && !allowUsers) continue;
    const raw = rawInput[def.key];
    if (!raw || raw === 'none') continue;
    if (!def.levels.some((l) => l.value === raw)) continue;
    out[def.key] = raw;
  }
  return out;
}

export function emptyModulePermissions(): ModulePermissionsMap {
  const out: ModulePermissionsMap = {};
  for (const k of MODULE_KEYS) out[k] = 'none';
  return out;
}

export const ALL_PERMISSIONS_LIST: Permission[] = [...PERMISSIONS];
