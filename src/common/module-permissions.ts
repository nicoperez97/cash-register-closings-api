import { GlobalRole, Permission, PERMISSIONS, ROLE_PERMISSIONS } from './enums';

/** Claves de módulo en `user_shops.modulePermissions`. */
export type ModuleKey =
  | 'closings'
  | 'reports'
  | 'movements'
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
  | 'stock'
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
    key: 'reports',
    label: 'Reportes',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'export', label: 'Exportar' },
    ],
  },
  {
    key: 'movements',
    label: 'Movimientos',
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
    key: 'stock',
    label: 'Stock',
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

  pair('movements', 'movements.read', 'movements.manage');
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
  pair('stock', 'stock.read', 'stock.manage');
  // Quien gestiona pagos puede elegir / crear proveedores en el formulario.
  if (modules.payments === 'manage') add(set, 'suppliers.read', 'suppliers.manage');
  if (modules.payments === 'read') add(set, 'suppliers.read');

  if (modules.accounts === 'manage') add(set, 'accounts.manage', 'movements.read');
  if (modules.concepts === 'manage') add(set, 'concepts.manage', 'movements.read');
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
    if (has('closings.read') && !has('closings.create')) return 'read';
    if (has('closings.create') && has('closings.read')) return 'read';
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
    reports: reports(),
    movements: level('movements.read', 'movements.manage'),
    attendance: attendance(),
    employees: level('employees.read', 'employees.manage'),
    candidates: level('candidates.read', 'candidates.manage'),
    payroll: level('payroll.read', 'payroll.manage'),
    commissions: level('commissions.read', 'commissions.manage'),
    reservations: level('reservations.read', 'reservations.manage'),
    waitingList: level('waitingList.read', 'waitingList.manage'),
    payments: level('payments.read', 'payments.manage'),
    suppliers: level('suppliers.read', 'suppliers.manage'),
    stock: level('stock.read', 'stock.manage'),
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
  const out: ModulePermissionsMap = {};
  for (const def of MODULE_DEFS) {
    if (def.key === 'users' && !allowUsers) continue;
    const raw = input[def.key];
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
