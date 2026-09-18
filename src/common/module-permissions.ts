import { GlobalRole, Permission, PERMISSIONS, ROLE_PERMISSIONS } from './enums';

/** Claves de módulo en `user_shops.modulePermissions`. */
export type ModuleKey =
  | 'closings'
  | 'cashWithdrawals'
  | 'settlements'
  | 'reports'
  | 'reportsConcepts'
  | 'reportsProducts'
  | 'reportsStats'
  | 'movements'
  | 'expenses'
  | 'accountTransfers'
  | 'partnerSplits'
  | 'splits'
  | 'accountBalances'
  | 'transactions'
  | 'incomes'
  | 'attendance'
  | 'productionAttendance'
  | 'employees'
  | 'candidates'
  | 'payroll'
  | 'commissions'
  | 'accounts'
  | 'concepts'
  | 'reservations'
  | 'salonTables'
  | 'diagrama'
  | 'salonRules'
  | 'salonHours'
  | 'waitingList'
  | 'paymentsSuppliers'
  | 'paymentsServices'
  | 'paymentsEmployees'
  | 'paymentsPartners'
  | 'suppliers'
  | 'services'
  | 'stock'
  | 'beverageStock'
  | 'shortages'
  | 'orders'
  | 'customerOrders'
  | 'orderingCatalog'
  | 'promos'
  | 'comanda'
  | 'integrations'
  | 'tips'
  | 'reimbursements'
  | 'vacations'
  | 'serviceRules'
  | 'publicPages'
  | 'publicMenu'
  | 'publicOrdering'
  | 'publicOrderLookup'
  | 'publicWaiter'
  | 'publicReservationsBoard'
  | 'publicReservationSignup'
  | 'publicReservationLookup'
  | 'publicWaiting'
  | 'publicAttendance'
  | 'publicNormas'
  | 'shop'
  | 'shopConfig'
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
    label: 'Reportes · Cierres',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'export', label: 'Exportar' },
    ],
  },
  {
    key: 'reportsConcepts',
    label: 'Reportes · Conceptos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'reportsProducts',
    label: 'Reportes · Ventas POS',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'reportsStats',
    label: 'Reportes · Estadísticas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
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
    key: 'splits',
    label: 'Divisiones',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'accountBalances',
    label: 'Saldos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'transactions',
    label: 'Transacciones',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
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
    label: 'Presentismo de salón',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'self', label: 'Solo mis horas (producción)' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'productionAttendance',
    label: 'Horas de cocina',
    levels: [
      { value: 'none', label: 'Ninguno' },
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
    key: 'salonTables',
    label: 'Mesas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'diagrama',
    label: 'Diagrama',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'salonRules',
    label: 'Reglas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'salonHours',
    label: 'Horarios',
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
    key: 'paymentsSuppliers',
    label: 'Pagos · Proveedores',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'paymentsServices',
    label: 'Pagos · Servicios',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'paymentsEmployees',
    label: 'Pagos · Empleados',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'paymentsPartners',
    label: 'Pagos · Socios',
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
    key: 'customerOrders',
    label: 'Pedidos online',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'orderingCatalog',
    label: 'Carta',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'promos',
    label: 'Promos',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'comanda',
    label: 'Comanda',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'integrations',
    label: 'Integraciones',
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
    key: 'vacations',
    label: 'Vacaciones',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
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
    key: 'publicMenu',
    label: 'Carta pública',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicOrdering',
    label: 'Pedir (público)',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicOrderLookup',
    label: 'Consultar pedido',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicWaiter',
    label: 'Comanda mozos (link)',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicReservationsBoard',
    label: 'Tablero de reservas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicReservationSignup',
    label: 'Reservar (público)',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicReservationLookup',
    label: 'Consultar reserva',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicWaiting',
    label: 'Lista de espera (pública)',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicAttendance',
    label: 'Presentismo público',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'publicNormas',
    label: 'Normas públicas',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
    ],
  },
  {
    key: 'shop',
    label: 'Local / POS',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
      { value: 'manage', label: 'Gestionar' },
    ],
  },
  {
    key: 'shopConfig',
    label: 'Configuración del local',
    levels: [
      { value: 'none', label: 'Ninguno' },
      { value: 'read', label: 'Ver' },
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
  if (modules.reportsConcepts === 'read') add(set, 'reportsConcepts.read');
  if (modules.reportsProducts === 'read') add(set, 'reportsProducts.read');
  if (modules.reportsStats === 'read') add(set, 'reportsStats.read');

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
  pair('splits', 'splits.read', 'splits.manage');
  if (modules.accountBalances === 'read') add(set, 'accountBalances.read');
  if (modules.transactions === 'read') add(set, 'transactions.read');
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
  pair('productionAttendance', 'productionAttendance.read', 'productionAttendance.manage');
  pair('employees', 'employees.read', 'employees.manage');
  pair('candidates', 'candidates.read', 'candidates.manage');
  pair('payroll', 'payroll.read', 'payroll.manage');
  pair('commissions', 'commissions.read', 'commissions.manage');
  pair('reservations', 'reservations.read', 'reservations.manage');
  pair('salonTables', 'salonTables.read', 'salonTables.manage');
  pair('diagrama', 'diagrama.read', 'diagrama.manage');
  pair('salonRules', 'salonRules.read', 'salonRules.manage');
  pair('salonHours', 'salonHours.read', 'salonHours.manage');
  pair('waitingList', 'waitingList.read', 'waitingList.manage');
  pair('paymentsSuppliers', 'paymentsSuppliers.read', 'paymentsSuppliers.manage');
  pair('paymentsServices', 'paymentsServices.read', 'paymentsServices.manage');
  pair('paymentsEmployees', 'paymentsEmployees.read', 'paymentsEmployees.manage');
  pair('paymentsPartners', 'paymentsPartners.read', 'paymentsPartners.manage');
  {
    const payLevels = [
      modules.paymentsSuppliers,
      modules.paymentsServices,
      modules.paymentsEmployees,
      modules.paymentsPartners,
      // legacy key
      (modules as Record<string, string>).payments,
    ];
    if (payLevels.some((l) => l === 'read' || l === 'manage')) add(set, 'payments.read');
    if (payLevels.some((l) => l === 'manage')) add(set, 'payments.manage');
  }
  pair('suppliers', 'suppliers.read', 'suppliers.manage');
  pair('services', 'services.read', 'services.manage');
  pair('stock', 'stock.read', 'stock.manage');
  pair('beverageStock', 'beverageStock.read', 'beverageStock.manage');
  pair('shortages', 'shortages.read', 'shortages.manage');
  pair('orders', 'orders.read', 'orders.manage');
  pair('customerOrders', 'customerOrders.read', 'customerOrders.manage');
  pair('integrations', 'integrations.read', 'integrations.manage');
  if (modules.orderingCatalog === 'manage') add(set, 'orderingCatalog.manage');
  if (modules.promos === 'manage') add(set, 'promos.manage');
  if (modules.comanda === 'manage') add(set, 'comanda.manage');
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
  pair('vacations', 'vacations.read', 'vacations.manage');
  switch (modules.serviceRules) {
    case 'read':
      add(set, 'serviceRules.read');
      break;
    case 'manage':
      add(set, 'serviceRules.read', 'serviceRules.manage');
      break;
  }
  if (modules.publicMenu === 'read') add(set, 'publicMenu.read');
  if (modules.publicOrdering === 'read') add(set, 'publicOrdering.read');
  if (modules.publicOrderLookup === 'read') add(set, 'publicOrderLookup.read');
  if (modules.publicWaiter === 'read') add(set, 'publicWaiter.read');
  if (modules.publicReservationsBoard === 'read') add(set, 'publicReservationsBoard.read');
  if (modules.publicReservationSignup === 'read') add(set, 'publicReservationSignup.read');
  if (modules.publicReservationLookup === 'read') add(set, 'publicReservationLookup.read');
  if (modules.publicWaiting === 'read') add(set, 'publicWaiting.read');
  if (modules.publicAttendance === 'read') add(set, 'publicAttendance.read');
  if (modules.publicNormas === 'read') add(set, 'publicNormas.read');
  if (modules.publicPages === 'read') {
    add(
      set,
      'publicMenu.read',
      'publicOrdering.read',
      'publicOrderLookup.read',
      'publicWaiter.read',
      'publicReservationsBoard.read',
      'publicReservationSignup.read',
      'publicReservationLookup.read',
      'publicWaiting.read',
      'publicAttendance.read',
      'publicNormas.read',
      'publicPages.read',
    );
  }
  // Quien gestiona pagos puede elegir / crear proveedores en el formulario.
  if (
    modules.paymentsSuppliers === 'manage' ||
    modules.paymentsServices === 'manage' ||
    modules.paymentsEmployees === 'manage' ||
    modules.paymentsPartners === 'manage' ||
    (modules as Record<string, string>).payments === 'manage'
  ) {
    add(set, 'suppliers.read', 'suppliers.manage', 'services.read', 'services.manage');
  } else if (
    modules.paymentsSuppliers === 'read' ||
    modules.paymentsServices === 'read' ||
    modules.paymentsEmployees === 'read' ||
    modules.paymentsPartners === 'read' ||
    (modules as Record<string, string>).payments === 'read'
  ) {
    add(set, 'suppliers.read', 'services.read');
  }

  if (modules.accounts === 'manage') {
    add(set, 'accounts.manage', 'expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read');
  }
  if (modules.concepts === 'manage') {
    add(set, 'concepts.manage', 'expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read');
  }
  if (modules.shop === 'read') add(set, 'shops.read');
  if (modules.shop === 'manage') add(set, 'shops.read', 'shops.manage');
  // Legacy: shop sin shopConfig explícito → mismo nivel en config del local.
  const shopConfigLevel = Object.prototype.hasOwnProperty.call(modules, 'shopConfig')
    ? modules.shopConfig
    : modules.shop === 'read' || modules.shop === 'manage'
      ? modules.shop
      : undefined;
  if (shopConfigLevel === 'read') add(set, 'shopConfig.read');
  if (shopConfigLevel === 'manage') add(set, 'shopConfig.read', 'shopConfig.manage');
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
    reportsConcepts: has('reportsConcepts.read') || has('reports.view') ? 'read' : 'none',
    reportsProducts: has('reportsProducts.read') || has('reports.view') ? 'read' : 'none',
    reportsStats: has('reportsStats.read') || has('reports.view') ? 'read' : 'none',
    expenses: level('expenses.read', 'expenses.manage'),
    accountTransfers: level('accountTransfers.read', 'accountTransfers.manage'),
    partnerSplits: level('partnerSplits.read', 'partnerSplits.manage'),
    splits:
      level('splits.read', 'splits.manage') !== 'none'
        ? level('splits.read', 'splits.manage')
        : level('partnerSplits.read', 'partnerSplits.manage'),
    accountBalances:
      has('accountBalances.read') ||
      has('expenses.read') ||
      has('incomes.read') ||
      has('accountTransfers.read')
        ? 'read'
        : 'none',
    transactions:
      has('transactions.read') ||
      has('expenses.read') ||
      has('incomes.read') ||
      has('accountTransfers.read')
        ? 'read'
        : 'none',
    incomes: level('incomes.read', 'incomes.manage'),
    attendance: attendance(),
    productionAttendance:
      level('productionAttendance.read', 'productionAttendance.manage') !== 'none'
        ? level('productionAttendance.read', 'productionAttendance.manage')
        : attendance() === 'self'
          ? 'none'
          : attendance(),
    employees: level('employees.read', 'employees.manage'),
    candidates: level('candidates.read', 'candidates.manage'),
    payroll: level('payroll.read', 'payroll.manage'),
    commissions: level('commissions.read', 'commissions.manage'),
    reservations: level('reservations.read', 'reservations.manage'),
    salonTables: level('salonTables.read', 'salonTables.manage'),
    diagrama: level('diagrama.read', 'diagrama.manage'),
    salonRules: level('salonRules.read', 'salonRules.manage'),
    salonHours: level('salonHours.read', 'salonHours.manage'),
    waitingList: level('waitingList.read', 'waitingList.manage'),
    paymentsSuppliers: (() => {
      const l = level('paymentsSuppliers.read', 'paymentsSuppliers.manage');
      if (l !== 'none') return l;
      if (has('payments.manage')) return 'manage';
      if (has('payments.read')) return 'read';
      return 'none';
    })(),
    paymentsServices: (() => {
      const l = level('paymentsServices.read', 'paymentsServices.manage');
      if (l !== 'none') return l;
      if (has('payments.manage')) return 'manage';
      if (has('payments.read')) return 'read';
      return 'none';
    })(),
    paymentsEmployees: (() => {
      const l = level('paymentsEmployees.read', 'paymentsEmployees.manage');
      if (l !== 'none') return l;
      if (has('payments.manage')) return 'manage';
      if (has('payments.read')) return 'read';
      return 'none';
    })(),
    paymentsPartners: (() => {
      const l = level('paymentsPartners.read', 'paymentsPartners.manage');
      if (l !== 'none') return l;
      if (has('payments.manage')) return 'manage';
      if (has('payments.read')) return 'read';
      return 'none';
    })(),
    suppliers: level('suppliers.read', 'suppliers.manage'),
    services: level('services.read', 'services.manage'),
    stock: level('stock.read', 'stock.manage'),
    beverageStock: level('beverageStock.read', 'beverageStock.manage'),
    shortages: level('shortages.read', 'shortages.manage'),
    orders: level('orders.read', 'orders.manage'),
    customerOrders: level('customerOrders.read', 'customerOrders.manage'),
    orderingCatalog: has('orderingCatalog.manage') ? 'manage' : 'none',
    promos: has('promos.manage') || has('orderingCatalog.manage') ? 'manage' : 'none',
    comanda: has('comanda.manage') ? 'manage' : 'none',
    integrations: level('integrations.read', 'integrations.manage'),
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
    vacations: level('vacations.read', 'vacations.manage'),
    serviceRules: level('serviceRules.read', 'serviceRules.manage'),
    publicMenu: has('publicMenu.read') || has('publicPages.read') ? 'read' : 'none',
    publicOrdering: has('publicOrdering.read') || has('publicPages.read') ? 'read' : 'none',
    publicOrderLookup: has('publicOrderLookup.read') || has('publicPages.read') ? 'read' : 'none',
    publicWaiter: has('publicWaiter.read') || has('publicPages.read') ? 'read' : 'none',
    publicReservationsBoard:
      has('publicReservationsBoard.read') || has('publicPages.read') ? 'read' : 'none',
    publicReservationSignup:
      has('publicReservationSignup.read') || has('publicPages.read') ? 'read' : 'none',
    publicReservationLookup:
      has('publicReservationLookup.read') || has('publicPages.read') ? 'read' : 'none',
    publicWaiting: has('publicWaiting.read') || has('publicPages.read') ? 'read' : 'none',
    publicAttendance: has('publicAttendance.read') || has('publicPages.read') ? 'read' : 'none',
    publicNormas: has('publicNormas.read') || has('publicPages.read') ? 'read' : 'none',
    accounts: has('accounts.manage') ? 'manage' : 'none',
    concepts: has('concepts.manage') ? 'manage' : 'none',
    shop: has('shops.manage') ? 'manage' : has('shops.read') ? 'read' : 'none',
    shopConfig: has('shopConfig.manage')
      ? 'manage'
      : has('shopConfig.read')
        ? 'read'
        : has('shops.manage')
          ? 'manage'
          : has('shops.read')
            ? 'read'
            : 'none',
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
  const ordersExplicit = Object.prototype.hasOwnProperty.call(rawInput, 'orders');
  if (!ordersExplicit) {
    const fromStock = [rawInput.stock, rawInput.beverageStock, rawInput.shortages];
    if (fromStock.includes('manage')) rawInput.orders = 'manage';
    else if (fromStock.includes('read')) rawInput.orders = 'read';
  }
  const shopConfigExplicit = Object.prototype.hasOwnProperty.call(rawInput, 'shopConfig');
  if (
    !shopConfigExplicit &&
    (rawInput.shop === 'read' || rawInput.shop === 'manage') &&
    (!rawInput.shopConfig || rawInput.shopConfig === 'none')
  ) {
    // Migración soft al guardar: Local/POS antiguo incluía config del local.
    rawInput.shopConfig = rawInput.shop;
  }
  // Legacy: un solo módulo "salon" → Mesas / Diagrama / Reglas / Horarios.
  const legacySalon = rawInput.salon;
  if (legacySalon && legacySalon !== 'none') {
    for (const key of ['salonTables', 'diagrama', 'salonRules', 'salonHours'] as const) {
      if (!Object.prototype.hasOwnProperty.call(rawInput, key) || rawInput[key] === 'none') {
        rawInput[key] = legacySalon;
      }
    }
    delete rawInput.salon;
  }
  // Legacy: un solo "payments" → cuatro tipos.
  const legacyPayments = rawInput.payments;
  if (legacyPayments && legacyPayments !== 'none') {
    for (const key of [
      'paymentsSuppliers',
      'paymentsServices',
      'paymentsEmployees',
      'paymentsPartners',
    ] as const) {
      if (!Object.prototype.hasOwnProperty.call(rawInput, key) || rawInput[key] === 'none') {
        rawInput[key] = legacyPayments;
      }
    }
    delete rawInput.payments;
  }
  const out: ModulePermissionsMap = {};
  for (const def of MODULE_DEFS) {
    if (def.key === 'users' && !allowUsers) continue;
    const raw = rawInput[def.key];
    if ((def.key === 'orders' || def.key === 'shopConfig') && raw === 'none') {
      out[def.key] = 'none';
      continue;
    }
    if (!raw || raw === 'none') continue;
    if (!def.levels.some((l) => l.value === raw)) continue;
    out[def.key] = raw;
  }
  // Legacy publicPages → todas las páginas públicas
  if (rawInput.publicPages === 'read') {
    for (const k of [
      'publicMenu',
      'publicOrdering',
      'publicOrderLookup',
      'publicWaiter',
      'publicReservationsBoard',
      'publicReservationSignup',
      'publicReservationLookup',
      'publicWaiting',
      'publicAttendance',
      'publicNormas',
    ] as ModuleKey[]) {
      if (!out[k]) out[k] = 'read';
    }
  }
  return out;
}

export function emptyModulePermissions(): ModulePermissionsMap {
  const out: ModulePermissionsMap = {};
  for (const k of MODULE_KEYS) out[k] = 'none';
  return out;
}

export const ALL_PERMISSIONS_LIST: Permission[] = [...PERMISSIONS];
