import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { GlobalRole } from './enums';
import { AuthUser } from './decorators';
import {
  PermissionsGuard,
  canManageUsersSomewhere,
  resolveUserPermissions,
} from './guards';
import { MANAGE_USERS_KEY } from './decorators';

function mockUser(partial: Partial<AuthUser> & Pick<AuthUser, 'id' | 'email' | 'fullName' | 'globalRole'>): AuthUser {
  return {
    shopIds: [],
    shopRoles: {},
    shopAccountIds: {},
    shopPermissions: {},
    shopModulePermissions: {},
    permissions: [],
    ...partial,
  };
}

describe('resolveUserPermissions', () => {
  const shopId = 'shop-1';

  it('devuelve shopPermissions explícitos (incluso vacíos)', () => {
    const user = mockUser({
      id: 'u1',
      email: 'a@b.com',
      fullName: 'A',
      globalRole: GlobalRole.CASHIER,
      shopIds: [shopId],
      shopPermissions: { [shopId]: ['closings.create', 'closings.read'] },
    });
    expect(resolveUserPermissions(user, shopId)).toEqual([
      'closings.create',
      'closings.read',
    ]);
  });

  it('sin clave de shop → deniega', () => {
    const user = mockUser({
      id: 'u1',
      email: 'a@b.com',
      fullName: 'A',
      globalRole: GlobalRole.CASHIER,
      shopIds: [shopId],
      shopPermissions: {},
    });
    expect(resolveUserPermissions(user, shopId)).toEqual([]);
  });

  it('admin global → todos los permisos', () => {
    const user = mockUser({
      id: 'u1',
      email: 'a@b.com',
      fullName: 'A',
      globalRole: GlobalRole.ADMIN,
      permissions: ['closings.read', 'users.manage'],
    });
    expect(resolveUserPermissions(user, shopId)).toContain('users.manage');
  });
});

describe('canManageUsersSomewhere', () => {
  it('cajero closings-only no gestiona usuarios', () => {
    const user = mockUser({
      id: 'u1',
      email: 'c@b.com',
      fullName: 'Cajero',
      globalRole: GlobalRole.CASHIER,
      shopIds: ['s1'],
      shopPermissions: {
        s1: ['closings.create', 'closings.read'],
      },
      shopRoles: { s1: GlobalRole.CASHIER },
    });
    expect(canManageUsersSomewhere(user)).toBe(false);
  });

  it('admin del local sí gestiona usuarios', () => {
    const user = mockUser({
      id: 'u1',
      email: 'a@b.com',
      fullName: 'Admin',
      globalRole: GlobalRole.CASHIER,
      shopIds: ['s1'],
      shopRoles: { s1: GlobalRole.ADMIN },
      permissions: [],
    });
    expect(canManageUsersSomewhere(user)).toBe(true);
  });
});

describe('PermissionsGuard @RequireManageUsers', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector);

  function ctxFor(user: AuthUser | undefined): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user, params: {}, query: {}, body: {} }),
      }),
    } as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bloquea cajero en endpoints de usuarios', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) => {
      if (key === MANAGE_USERS_KEY) return true;
      return undefined;
    });
    const user = mockUser({
      id: 'u1',
      email: 'c@b.com',
      fullName: 'Cajero',
      globalRole: GlobalRole.CASHIER,
      shopIds: ['s1'],
      shopPermissions: { s1: ['closings.create', 'closings.read'] },
    });
    expect(() => guard.canActivate(ctxFor(user))).toThrow(ForbiddenException);
  });

  it('permite admin global', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) => {
      if (key === MANAGE_USERS_KEY) return true;
      return undefined;
    });
    const user = mockUser({
      id: 'u1',
      email: 'a@b.com',
      fullName: 'Admin',
      globalRole: GlobalRole.ADMIN,
      permissions: ['users.manage'],
    });
    expect(guard.canActivate(ctxFor(user))).toBe(true);
  });
});
