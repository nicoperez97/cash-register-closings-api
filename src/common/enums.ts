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
  /** Producto de stock por debajo del mínimo de su categoría. */
  STOCK_BELOW_MINIMUM = 'STOCK_BELOW_MINIMUM',
  /** Alguien compartió el snapshot de stock actual con admins de stock. */
  STOCK_SHARED = 'STOCK_SHARED',
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
  [NotificationType.STOCK_BELOW_MINIMUM]: 'Stock bajo el mínimo',
  [NotificationType.STOCK_SHARED]: 'Stock compartido',
};

export const ALL_NOTIFICATION_TYPES: NotificationType[] = Object.values(NotificationType);

export enum ExpenseCategory {
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

export enum LedgerAccountType {
  PARTNER = 'PARTNER',
  CHANNEL = 'CHANNEL',
  SYSTEM = 'SYSTEM',
  /** Cuenta de proveedor: no aparece en «quién se lo lleva». */
  SUPPLIER = 'SUPPLIER',
}

export enum ConceptKind {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  TRANSFER = 'TRANSFER',
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
  'stock.read',
  'stock.manage',
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
    'reports.view',
    'reports.export',
    'shops.manage',
    'employees.manage',
    'employees.read',
    'candidates.manage',
    'candidates.read',
    'attendance.manage',
    'attendance.read',
    'payroll.manage',
    'payroll.read',
    'commissions.manage',
    'commissions.read',
    'movements.manage',
    'movements.read',
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
    'stock.read',
    'stock.manage',
  ],
  [GlobalRole.CASHIER]: ['closings.create'],
  [GlobalRole.VIEWER]: [
    'closings.read',
    'reports.view',
    'reports.export',
    'employees.read',
    'candidates.read',
    'attendance.read',
    'payroll.read',
    'commissions.read',
    'movements.read',
    'reservations.read',
    'payments.read',
    'suppliers.read',
    'stock.read',
  ],
  [GlobalRole.PARTNER]: [
    'closings.read',
    'reports.view',
    'reports.export',
    'movements.read',
    'payments.read',
    'suppliers.read',
  ],
};
