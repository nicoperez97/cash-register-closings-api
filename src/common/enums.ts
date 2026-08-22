export enum GlobalRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  CASHIER = 'CASHIER',
  VIEWER = 'VIEWER',
  /** Socio: acceso de lectura a movimientos/reportes; suele vincularse a una cuenta. */
  PARTNER = 'PARTNER',
}

export enum ClosingStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  LOCKED = 'LOCKED',
}

/** Retiro de efectivo del cierre aún no asignado a un socio. */
export enum CashPendingWithdrawalStatus {
  PENDING = 'PENDING',
  PICKED = 'PICKED',
}

export enum PaymentStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  VALIDATED = 'VALIDATED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

/** Forma de pago al abonar (egreso a proveedor/empleado). */
export enum PaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  CARD = 'card',
  OTHER = 'other',
}

/** Prioridad opcional del pago. */
export enum PaymentPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum ShortageLevel {
  NONE = 'NONE',
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
}

/** Fase de una norma de servicio (antes / después del turno). */
export enum ServiceRulePhase {
  PRE = 'PRE',
  DURING = 'DURING',
  POST = 'POST',
}

export enum NotificationType {
  PAYMENT_VALIDATE = 'PAYMENT_VALIDATE',
  PAYMENT_PAY = 'PAYMENT_PAY',
  PAYMENT_REJECTED = 'PAYMENT_REJECTED',
  PAYMENT_PAID = 'PAYMENT_PAID',
  CLOSING_CREATED = 'CLOSING_CREATED',
  /** Efectivo retirado desde «A Retirar» (o asignado a un socio). */
  CASH_WITHDRAWAL_PICKED = 'CASH_WITHDRAWAL_PICKED',
  /** Productor cargó / actualizó sus horas de producción. */
  PRODUCTION_HOURS_LOGGED = 'PRODUCTION_HOURS_LOGGED',
  /** Producto de stock alimentos por debajo del mínimo. */
  STOCK_BELOW_MINIMUM = 'STOCK_BELOW_MINIMUM',
  /** Alguien compartió el snapshot de stock alimentos con admins. */
  STOCK_SHARED = 'STOCK_SHARED',
  /** Producto de stock bebidas por debajo del mínimo. */
  BEVERAGE_STOCK_BELOW_MINIMUM = 'BEVERAGE_STOCK_BELOW_MINIMUM',
  /** Alguien compartió el snapshot de stock bebidas con admins. */
  BEVERAGE_STOCK_SHARED = 'BEVERAGE_STOCK_SHARED',
  /** Faltante creado con nivel Nada/Poco. */
  SHORTAGE_CREATED = 'SHORTAGE_CREATED',
  /** Faltante bajó de Normal/Mucho a Nada/Poco. */
  SHORTAGE_LEVEL_LOW = 'SHORTAGE_LEVEL_LOW',
  /** Faltante subió de Nada/Poco a Normal/Mucho. */
  SHORTAGE_RESOLVED = 'SHORTAGE_RESOLVED',
  /** Solicitud de reserva pública pendiente. */
  RESERVATION_REQUEST = 'RESERVATION_REQUEST',
  /** Movimiento o gasto rápido creado a mano. */
  MOVEMENT_CREATED = 'MOVEMENT_CREATED',
  /** Gasto editado a mano. */
  MOVEMENT_UPDATED = 'MOVEMENT_UPDATED',
  /** Gasto borrado a mano. */
  MOVEMENT_DELETED = 'MOVEMENT_DELETED',
  /** Pago editado a mano. */
  PAYMENT_UPDATED = 'PAYMENT_UPDATED',
  /** Pago borrado a mano. */
  PAYMENT_DELETED = 'PAYMENT_DELETED',
  /** Productor cargó un gasto a reintegrar. */
  REIMBURSEMENT_CREATED = 'REIMBURSEMENT_CREATED',
}

/** Etiquetas para UI de configuración de mails del local. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  [NotificationType.PAYMENT_VALIDATE]: 'Pagos · pendiente de validar',
  [NotificationType.PAYMENT_PAY]: 'Pagos · pendiente de abonar',
  [NotificationType.PAYMENT_REJECTED]: 'Pagos · rechazados',
  [NotificationType.PAYMENT_PAID]: 'Pagos · abonados',
  [NotificationType.CLOSING_CREATED]: 'Cierres creados',
  [NotificationType.CASH_WITHDRAWAL_PICKED]: 'Retiros de efectivo',
  [NotificationType.PRODUCTION_HOURS_LOGGED]: 'Horas de producción cargadas',
  [NotificationType.STOCK_BELOW_MINIMUM]: 'Stock alimentos · bajo el mínimo',
  [NotificationType.STOCK_SHARED]: 'Stock alimentos · compartido',
  [NotificationType.BEVERAGE_STOCK_BELOW_MINIMUM]: 'Stock bebidas · bajo el mínimo',
  [NotificationType.BEVERAGE_STOCK_SHARED]: 'Stock bebidas · compartido',
  [NotificationType.SHORTAGE_CREATED]: 'Faltantes · crítico cargado',
  [NotificationType.SHORTAGE_LEVEL_LOW]: 'Faltantes · bajó a crítico',
  [NotificationType.SHORTAGE_RESOLVED]: 'Faltantes · resuelto',
  [NotificationType.RESERVATION_REQUEST]: 'Reservas · solicitud nueva',
  [NotificationType.MOVEMENT_CREATED]: 'Movimientos y gastos rápidos',
  [NotificationType.MOVEMENT_UPDATED]: 'Gastos · editados',
  [NotificationType.MOVEMENT_DELETED]: 'Gastos · eliminados',
  [NotificationType.PAYMENT_UPDATED]: 'Pagos · editados',
  [NotificationType.PAYMENT_DELETED]: 'Pagos · eliminados',
  [NotificationType.REIMBURSEMENT_CREATED]: 'Reintegros · gasto de productor',
};

export const ALL_NOTIFICATION_TYPES: NotificationType[] = Object.values(NotificationType);

/** Gasto de productor a reintegrar. */
export enum ReimbursementStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum ExpenseCategory {
  // Rubros gastronómicos
  VEGETABLES = 'VEGETABLES',
  CHEESE = 'CHEESE',
  MEAT = 'MEAT',
  FISH = 'FISH',
  BAKERY = 'BAKERY',
  DELI = 'DELI',
  GROCERY = 'GROCERY',
  DAIRY = 'DAIRY',
  BEVERAGES = 'BEVERAGES',
  BAR = 'BAR',
  COFFEE = 'COFFEE',
  // Operación (legacy + actuales)
  SUPPLIES = 'SUPPLIES',
  SERVICES = 'SERVICES',
  TRANSFER_SHOP = 'TRANSFER_SHOP',
  OTHER = 'OTHER',
  RAW_MATERIALS = 'RAW_MATERIALS',
  DRINKS = 'DRINKS',
  SALARIES = 'SALARIES',
  RENT = 'RENT',
  EQUIPMENT = 'EQUIPMENT',
  CLEANING = 'CLEANING',
  DISPOSABLES = 'DISPOSABLES',
  UTILITIES = 'UTILITIES',
  MARKETING = 'MARKETING',
  COMMISSIONS = 'COMMISSIONS',
}

export enum ExtraLineType {
  STUDENT_CASH = 'STUDENT_CASH',
  TIP_ALLOCATION = 'TIP_ALLOCATION',
  PVS_BREAKDOWN = 'PVS_BREAKDOWN',
  ADJUSTMENT = 'ADJUSTMENT',
  OTHER = 'OTHER',
}

/** Qué hacer con una fuente extra del cierre (Pedidos Ya, delivery, etc.). */
export enum ClosingSourceKind {
  /** Se deposita el mismo día en una cuenta del local. */
  OWN_ACCOUNT = 'OWN_ACCOUNT',
  /** Queda pendiente: el delivery/app rinde después en efectivo. */
  SETTLE_CASH = 'SETTLE_CASH',
  /** Queda pendiente: se deposita después en una cuenta del local. */
  SETTLE_ACCOUNT = 'SETTLE_ACCOUNT',
  /** Solo se registra; no genera asiento. */
  RECORD_ONLY = 'RECORD_ONLY',
}

export enum LedgerAccountType {
  PARTNER = 'PARTNER',
  CHANNEL = 'CHANNEL',
  SYSTEM = 'SYSTEM',
  /** Cuenta de proveedor: no aparece en «quién se lo lleva». */
  SUPPLIER = 'SUPPLIER',
  /** Cuenta de servicio: no aparece en «quién se lo lleva». */
  SERVICE = 'SERVICE',
}

export enum ConceptKind {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  TRANSFER = 'TRANSFER',
}

/** Dónde se puede usar un concepto (un concepto puede tener varias). */
export enum ConceptCategory {
  EMPLOYEES = 'EMPLOYEES',
  SERVICES = 'SERVICES',
  SUPPLIERS = 'SUPPLIERS',
  MOVEMENTS = 'MOVEMENTS',
  CLOSURE = 'CLOSURE',
  OTHERS = 'OTHERS',
}

export enum LinkedPaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  MERCADO_PAGO = 'mercadoPago',
  DELIVERY = 'delivery',
  TRANSFER = 'transfer',
  ACCOUNT_DNI = 'accountDni',
  OTHER = 'other',
}

export enum PayrollStatus {
  DRAFT = 'DRAFT',
  LOCKED = 'LOCKED',
}

export const PERMISSIONS = [
  'closings.create',
  'closings.read',
  'closings.update',
  'closings.lock',
  'cashWithdrawals.read',
  'cashWithdrawals.manage',
  'settlements.read',
  'settlements.manage',
  'reports.view',
  'reports.export',
  'shops.manage',
  'users.manage',
  'employees.manage',
  'employees.read',
  'candidates.manage',
  'candidates.read',
  'attendance.manage',
  'attendance.read',
  'attendance.self',
  'payroll.manage',
  'payroll.read',
  'commissions.manage',
  'commissions.read',
  'movements.manage',
  'movements.read',
  'expenses.manage',
  'expenses.read',
  'accountTransfers.manage',
  'accountTransfers.read',
  'accounts.manage',
  'concepts.manage',
  'reservations.read',
  'reservations.manage',
  'waitingList.read',
  'waitingList.manage',
  'payments.read',
  'payments.manage',
  'suppliers.read',
  'suppliers.manage',
  'services.read',
  'services.manage',
  'stock.read',
  'stock.manage',
  'beverageStock.read',
  'beverageStock.manage',
  'shortages.read',
  'shortages.manage',
  'tips.read',
  'tips.create',
  'tips.manage',
  'reimbursements.self',
  'reimbursements.read',
  'reimbursements.manage',
  'serviceRules.read',
  'serviceRules.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<GlobalRole, Permission[]> = {
  [GlobalRole.OWNER]: [...PERMISSIONS],
  [GlobalRole.ADMIN]: [...PERMISSIONS],
  [GlobalRole.MANAGER]: [
    'closings.create',
    'closings.read',
    'closings.update',
    'closings.lock',
    'cashWithdrawals.read',
    'cashWithdrawals.manage',
    'settlements.read',
    'settlements.manage',
    'reports.view',
    'reports.export',
    'shops.manage',
    'employees.manage',
    'employees.read',
    'candidates.manage',
    'candidates.read',
    'attendance.manage',
    'attendance.read',
    'serviceRules.read',
    'serviceRules.manage',
    'payroll.manage',
    'payroll.read',
    'commissions.manage',
    'commissions.read',
    'expenses.manage',
    'expenses.read',
    'accountTransfers.manage',
    'accountTransfers.read',
    'accounts.manage',
    'concepts.manage',
    'reservations.read',
    'reservations.manage',
    'waitingList.read',
    'waitingList.manage',
    'payments.read',
    'payments.manage',
    'suppliers.read',
    'suppliers.manage',
    'services.read',
    'services.manage',
    'stock.read',
    'stock.manage',
    'beverageStock.read',
    'beverageStock.manage',
    'shortages.read',
    'shortages.manage',
    'tips.read',
    'tips.create',
    'tips.manage',
    'reimbursements.read',
    'reimbursements.manage',
    'serviceRules.read',
    'serviceRules.manage',
  ],
  [GlobalRole.CASHIER]: ['closings.create', 'tips.create', 'tips.read'],
  [GlobalRole.VIEWER]: [
    'closings.read',
    'cashWithdrawals.read',
    'settlements.read',
    'reports.view',
    'reports.export',
    'employees.read',
    'candidates.read',
    'attendance.read',
    'serviceRules.read',
    'payroll.read',
    'commissions.read',
    'expenses.read',
    'accountTransfers.read',
    'reservations.read',
    'payments.read',
    'suppliers.read',
    'services.read',
    'stock.read',
    'beverageStock.read',
    'shortages.read',
    'tips.read',
    'reimbursements.read',
  ],
  [GlobalRole.PARTNER]: [
    'closings.read',
    'cashWithdrawals.read',
    'settlements.read',
    'reports.view',
    'reports.export',
    'expenses.read',
    'accountTransfers.read',
    'payments.read',
    'suppliers.read',
    'services.read',
  ],
};
