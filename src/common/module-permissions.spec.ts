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

  it('reservations-only: no incluye waitingList ni mesas/diagrama', () => {
    const perms = expandModulePermissions({ reservations: 'manage' });
    expect(perms).toEqual(
      expect.arrayContaining(['reservations.read', 'reservations.manage']),
    );
    expect(perms).not.toContain('waitingList.read');
    expect(perms).not.toContain('salonTables.read');
    expect(perms).not.toContain('diagrama.read');
  });

  it('mesas-only: no incluye diagrama ni reservas', () => {
    const perms = expandModulePermissions({ salonTables: 'manage' });
    expect(perms).toEqual(expect.arrayContaining(['salonTables.read', 'salonTables.manage']));
    expect(perms).not.toContain('diagrama.read');
    expect(perms).not.toContain('reservations.read');
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

  it('orders explícito none no se infiere desde stock', () => {
    const out = sanitizeModulePermissions({
      stock: 'manage',
      beverageStock: 'manage',
      shortages: 'manage',
      orders: 'none',
    });
    expect(out.orders).toBe('none');
    expect(expandModulePermissions(out)).not.toContain('orders.read');
  });

  it('sin orders en el mapa sí se infiere desde stock (legacy)', () => {
    const out = sanitizeModulePermissions({
      stock: 'read',
      beverageStock: 'manage',
    });
    expect(out.orders).toBe('manage');
  });

  it('customerOrders manage → historial manage + monitor read (legacy)', () => {
    const out = sanitizeModulePermissions({ customerOrders: 'manage' });
    expect(out.customerOrders).toBe('manage');
    expect(out.customerOrdersHistory).toBe('manage');
    expect(out.customerOrdersMonitor).toBe('read');
    const perms = expandModulePermissions(out);
    expect(perms).toEqual(
      expect.arrayContaining([
        'customerOrders.manage',
        'customerOrdersHistory.manage',
        'customerOrdersMonitor.read',
      ]),
    );
  });

  it('comanda manage → historial manage + monitor read (legacy)', () => {
    const out = sanitizeModulePermissions({ comanda: 'manage' });
    expect(out.comanda).toBe('manage');
    expect(out.comandaReceiptsHistory).toBe('manage');
    expect(out.comandaMonitor).toBe('read');
    const perms = expandModulePermissions(out);
    expect(perms).toEqual(
      expect.arrayContaining([
        'comanda.read',
        'comanda.manage',
        'comandaReceiptsHistory.manage',
        'comandaMonitor.read',
      ]),
    );
  });

  it('comanda read → comanda.read + historial/monitor soft', () => {
    const out = sanitizeModulePermissions({ comanda: 'read' });
    expect(out.comanda).toBe('read');
    expect(out.comandaReceiptsHistory).toBe('read');
    expect(out.comandaMonitor).toBe('read');
    const perms = expandModulePermissions(out);
    expect(perms).toEqual(
      expect.arrayContaining([
        'comanda.read',
        'comandaReceiptsHistory.read',
        'comandaMonitor.read',
      ]),
    );
    expect(perms).not.toContain('comanda.manage');
  });

  it('accounts/concepts/users/carta/promos: Ver otorga .read sin .manage', () => {
    const perms = expandModulePermissions({
      accounts: 'read',
      concepts: 'read',
      users: 'read',
      orderingCatalog: 'read',
      promos: 'read',
    });
    expect(perms).toEqual(
      expect.arrayContaining([
        'accounts.read',
        'concepts.read',
        'users.read',
        'orderingCatalog.read',
        'promos.read',
      ]),
    );
    expect(perms).not.toContain('accounts.manage');
    expect(perms).not.toContain('concepts.manage');
    expect(perms).not.toContain('users.manage');
    expect(perms).not.toContain('orderingCatalog.manage');
    expect(perms).not.toContain('promos.manage');
  });

  it('no pisa historial/monitor si ya están configurados', () => {
    const out = sanitizeModulePermissions({
      customerOrders: 'manage',
      customerOrdersHistory: 'read',
      customerOrdersMonitor: 'none',
    });
    expect(out.customerOrdersHistory).toBe('read');
    expect(out.customerOrdersMonitor).toBeUndefined();
  });
});
