/**
 * Abrir mesa desde Operación → Comanda eligiendo al usuario logueado («vos»):
 * con empleado vinculado queda a nombre del empleado; sin empleado, a nombre del usuario.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { WaiterService } from '../src/modules/waiter/waiter.service';
import type { WaiterAuthPayload } from '../src/modules/waiter/waiter-auth';
import { TableSession } from '../src/entities/table-session.entity';
import { CustomerOrder } from '../src/entities/customer-order.entity';
import { AuthUser } from '../src/common/decorators';
import { GlobalRole } from '../src/common/enums';
import {
  sessionWaiterKey,
  sessionWaiterName,
  waiterFilterWhere,
} from '../src/modules/waiter/session-waiter';
import { fakeRepo, fakeTx } from './helpers/fake-tx';

const SHOP = {
  id: 'shop-1',
  slug: 'demo',
  name: 'Demo',
  active: true,
  waiterOrderingEnabled: true,
  // Sin config: el perfil staff exige elegir mozo (requireWaiterOnOpen).
  waiterCapabilities: null,
};
const TABLE = { id: 'table-1', shopId: SHOP.id, active: true, name: 'M1' };

function staffUser(): AuthUser {
  return {
    id: 'u-encargado',
    email: 'encargado@test.local',
    fullName: 'Encargada Sin Legajo',
    globalRole: GlobalRole.OWNER,
    shopIds: [SHOP.id],
    shopRoles: { [SHOP.id]: GlobalRole.OWNER },
    shopAccountIds: {},
    shopModulePermissions: {},
    shopPermissions: {},
    permissions: [],
  } as unknown as AuthUser;
}

function setup(employees: Array<Record<string, unknown>>) {
  const sessionsTx = fakeRepo();
  const ordersTx = fakeRepo({ count: jest.fn().mockResolvedValue(0) });
  const { rootManager } = fakeTx(
    new Map<unknown, any>([
      [TableSession, sessionsTx],
      [CustomerOrder, ordersTx],
    ]),
  );
  const shops = fakeRepo({ findOne: jest.fn().mockResolvedValue(SHOP) });
  const employeesRepo = fakeRepo({
    find: jest.fn(async ({ where }: any) =>
      employees.filter((e) => e.shopId === where.shopId && e.userId === where.userId),
    ),
    findOne: jest.fn(
      async ({ where }: any) =>
        employees.find((e) => e.id === where.id && e.shopId === where.shopId) ?? null,
    ),
  });
  const tables = fakeRepo({ findOne: jest.fn().mockResolvedValue(TABLE) });
  const sessions = fakeRepo({ manager: rootManager });
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const shopsSvc = { assertShopAccess: jest.fn() };

  const service = new WaiterService(
    shops,
    employeesRepo,
    tables,
    fakeRepo(),
    fakeRepo(),
    sessions,
    fakeRepo(),
    fakeRepo(),
    jwt as any,
    {} as any,
    {} as any,
    {} as any,
    shopsSvc as any,
    {} as any,
  );
  jest
    .spyOn(service as any, 'finalizeOpenedSession')
    .mockImplementation(async (_shop: unknown, session: unknown) => session);

  /** Token real que arma «Entrar a Comanda» para el usuario. */
  const enter = async (): Promise<WaiterAuthPayload> => {
    await service.staffEnter(staffUser(), SHOP.id);
    return jwt.signAsync.mock.calls[0][0] as WaiterAuthPayload;
  };
  return { service, enter, sessionsTx };
}

describe('Comanda staff: abrir mesa a nombre del usuario logueado', () => {
  it('sin empleado vinculado: la mesa queda a nombre del usuario', async () => {
    const { service, enter, sessionsTx } = setup([]);
    const waiter = await enter();
    expect(waiter.employeeId).toBe('');
    expect(waiter.userId).toBe('u-encargado');
    expect(waiter.name).toBe('Encargada Sin Legajo');

    const session: any = await service.openSession(SHOP.slug, waiter, TABLE.id, 2, 'self');

    expect(sessionsTx.save).toHaveBeenCalledTimes(1);
    expect(session.salonTableId).toBe(TABLE.id);
    expect(session.covers).toBe(2);
    expect(session.waiterEmployeeId).toBeNull();
    expect(session.waiterUserId).toBe('u-encargado');
    expect(session.waiterUserName).toBe('Encargada Sin Legajo');
    expect(sessionWaiterKey(session)).toBe('user:u-encargado');
    expect(sessionWaiterName(session)).toBe('Encargada Sin Legajo');
  });

  it('elegir un mozo de la lista no guarda usuario', async () => {
    const { service, enter } = setup([
      { id: 'emp-1', shopId: SHOP.id, userId: null, fullName: 'Martín', active: true },
    ]);
    const waiter = await enter();
    const session: any = await service.openSession(SHOP.slug, waiter, TABLE.id, 2, 'emp-1');
    expect(session.waiterEmployeeId).toBe('emp-1');
    expect(session.waiterUserId).toBeNull();
    expect(session.waiterUserName).toBeNull();
  });

  it('con empleado vinculado (sin «Mostrar en Comanda»): queda a su nombre', async () => {
    const { service, enter } = setup([
      {
        id: 'emp-9',
        shopId: SHOP.id,
        userId: 'u-encargado',
        fullName: 'Encargada Con Legajo',
        active: true,
        showInComanda: false,
      },
    ]);
    const waiter = await enter();
    expect(waiter.employeeId).toBe('emp-9');

    const session: any = await service.openSession(SHOP.slug, waiter, TABLE.id, 3, 'self');
    expect(session.waiterEmployeeId).toBe('emp-9');
    expect(session.waiterUserId).toBeNull();
  });

  it('sigue exigiendo elegir mozo si no se manda ninguno', async () => {
    const { service, enter } = setup([]);
    const waiter = await enter();
    await expect(service.openSession(SHOP.slug, waiter, TABLE.id, 2, null)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('un mozo elegido de la lista se sigue validando', async () => {
    const { service, enter } = setup([]);
    const waiter = await enter();
    await expect(
      service.openSession(SHOP.slug, waiter, TABLE.id, 2, 'emp-inexistente'),
    ).rejects.toThrow('Mozo no válido');
  });
});

describe('session-waiter: a cargo = empleado o usuario', () => {
  it('el empleado tiene prioridad sobre el usuario', () => {
    const s = { waiterEmployeeId: 'emp-1', waiterUserId: 'u-1', waiterUserName: 'Ana' };
    expect(sessionWaiterKey(s)).toBe('emp-1');
    expect(sessionWaiterName(s, 'Martín')).toBe('Martín');
    // Empleado borrado: no se muestra el nombre del usuario en su lugar.
    expect(sessionWaiterName(s, null)).toBeNull();
  });

  it('sin nadie a cargo no hay clave ni nombre', () => {
    expect(sessionWaiterKey({})).toBeNull();
    expect(sessionWaiterName({})).toBeNull();
  });

  it('el filtro user:<id> busca por usuario', () => {
    expect(waiterFilterWhere('user:u-1')).toEqual({ waiterUserId: 'u-1' });
    expect(waiterFilterWhere('emp-1')).toEqual({ waiterEmployeeId: 'emp-1' });
  });
});
