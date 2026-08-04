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
}

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
