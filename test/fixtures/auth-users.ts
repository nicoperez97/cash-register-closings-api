import { AuthUser } from '../../src/common/decorators';
import { GlobalRole, PERMISSIONS } from '../../src/common/enums';

export const TEST_SHOP_ID = '00000000-0000-0000-0000-000000000001';

const base = {
  shopIds: [TEST_SHOP_ID],
  shopRoles: { [TEST_SHOP_ID]: GlobalRole.CASHIER },
  shopAccountIds: {} as Record<string, string[]>,
  shopModulePermissions: {} as Record<string, Record<string, string>>,
};

/** Preset Cajero: solo closings create (+ read expandido). */
export function cashierAuthUser(): AuthUser {
  const perms = ['closings.create', 'closings.read'] as const;
  return {
    id: 'user-cashier',
    email: 'cashier@test.local',
    fullName: 'Cajero Test',
    globalRole: GlobalRole.CASHIER,
    ...base,
    shopPermissions: { [TEST_SHOP_ID]: [...perms] },
    shopModulePermissions: { [TEST_SHOP_ID]: { closings: 'create' } },
    permissions: [...perms],
  };
}

/** Preset Recepcionista: reservas + lista de espera. */
export function receptionistAuthUser(): AuthUser {
  const perms = [
    'reservations.read',
    'reservations.manage',
    'waitingList.read',
    'waitingList.manage',
  ] as const;
  return {
    id: 'user-receptionist',
    email: 'reception@test.local',
    fullName: 'Recepcionista Test',
    globalRole: GlobalRole.MANAGER,
    ...base,
    shopRoles: { [TEST_SHOP_ID]: GlobalRole.MANAGER },
    shopPermissions: { [TEST_SHOP_ID]: [...perms] },
    shopModulePermissions: {
      [TEST_SHOP_ID]: { reservations: 'manage', waitingList: 'manage' },
    },
    permissions: [...perms],
  };
}

/** Admin de local. */
export function adminAuthUser(): AuthUser {
  return {
    id: 'user-admin',
    email: 'admin@test.local',
    fullName: 'Admin Test',
    globalRole: GlobalRole.ADMIN,
    shopIds: [TEST_SHOP_ID],
    shopRoles: { [TEST_SHOP_ID]: GlobalRole.ADMIN },
    shopAccountIds: {},
    shopModulePermissions: {},
    shopPermissions: { [TEST_SHOP_ID]: [...PERMISSIONS] },
    permissions: [...PERMISSIONS],
  };
}

export type TestAuthRole = 'cashier' | 'receptionist' | 'admin';

export const TEST_AUTH_USERS: Record<TestAuthRole, () => AuthUser> = {
  cashier: cashierAuthUser,
  receptionist: receptionistAuthUser,
  admin: adminAuthUser,
};

export function bearerFor(role: TestAuthRole): string {
  return `Bearer test:${role}`;
}
