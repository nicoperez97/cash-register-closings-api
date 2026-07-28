export enum GlobalRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  CASHIER = 'CASHIER',
  VIEWER = 'VIEWER',
}

export enum ClosingStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  LOCKED = 'LOCKED',
}

export enum ExpenseCategory {
  SUPPLIES = 'SUPPLIES',
  SERVICES = 'SERVICES',
  TRANSFER_SHOP = 'TRANSFER_SHOP',
  OTHER = 'OTHER',
}

export enum ExtraLineType {
  STUDENT_CASH = 'STUDENT_CASH',
  TIP_ALLOCATION = 'TIP_ALLOCATION',
  PVS_BREAKDOWN = 'PVS_BREAKDOWN',
  ADJUSTMENT = 'ADJUSTMENT',
  OTHER = 'OTHER',
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
  ],
  [GlobalRole.CASHIER]: ['closings.create', 'closings.read', 'closings.update'],
  [GlobalRole.VIEWER]: ['closings.read', 'reports.view', 'reports.export'],
};
