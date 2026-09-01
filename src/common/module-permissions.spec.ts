import { GlobalRole } from './enums';
import {
  deriveModulesFromRole,
  expandModulePermissions,
  sanitizeModulePermissions,
} from './module-permissions';

describe('expandModulePermissions', () => {
  it('preset closings-only: create incluye read pero no waitingList', () => {
    const perms = expandModulePermissions({ closings: 'create' });
    expect(perms).toEqual(expect.arrayContaining(['closings.create', 'closings.read']));
    expect(perms).not.toContain('waitingList.read');
    expect(perms).not.toContain('waitingList.manage');
    expect(perms).not.toContain('closings.update');
    expect(perms).not.toContain('closings.lock');
  });

  it('receptionist: reservas + lista de espera', () => {
    const perms = expandModulePermissions({
      reservations: 'manage',
      waitingList: 'manage',
    });
    expect(perms).toEqual(
      expect.arrayContaining([
        'reservations.read',
        'reservations.manage',
        'waitingList.read',
        'waitingList.manage',
      ]),
    );
  });

  it('reservations-only: no incluye waitingList', () => {
    const perms = expandModulePermissions({ reservations: 'manage' });
    expect(perms).toEqual(
      expect.arrayContaining(['reservations.read', 'reservations.manage']),
    );
    expect(perms).not.toContain('waitingList.read');
  });

  it('mapa vacío explícito → sin permisos', () => {
    expect(expandModulePermissions({})).toEqual([]);
  });
});

describe('deriveModulesFromRole', () => {
  it('CASHIER → closings create, sin waitingList', () => {
    const modules = deriveModulesFromRole(GlobalRole.CASHIER);
    expect(modules.closings).toBe('create');
    expect(modules.waitingList).toBe('none');
    const perms = expandModulePermissions(modules);
    expect(perms).toEqual(expect.arrayContaining(['closings.create', 'closings.read']));
    expect(perms).not.toContain('waitingList.read');
  });

  it('VIEWER → lectura de waitingList', () => {
    const modules = deriveModulesFromRole(GlobalRole.VIEWER);
    expect(modules.waitingList).toBe('read');
    expect(expandModulePermissions(modules)).toContain('waitingList.read');
  });

  it('MANAGER → waitingList manage', () => {
    const modules = deriveModulesFromRole(GlobalRole.MANAGER);
    expect(modules.waitingList).toBe('manage');
  });
});

describe('sanitizeModulePermissions', () => {
  it('bloquea users.manage sin allowUsersModule', () => {
    const out = sanitizeModulePermissions(
      { closings: 'create', users: 'manage' },
      { allowUsersModule: false },
    );
    expect(out.users).toBeUndefined();
    expect(out.closings).toBe('create');
  });

  it('permite users.manage con allowUsersModule', () => {
    const out = sanitizeModulePermissions(
      { users: 'manage' },
      { allowUsersModule: true },
    );
    expect(out.users).toBe('manage');
  });
});
