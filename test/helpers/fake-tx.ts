/**
 * Dobles mínimos de TypeORM para testear flujos transaccionales sin DB.
 *
 * - `fakeRepo()`: repo con jest.fn() en los métodos que usan los servicios.
 * - `fakeTx(repos)`: EntityManager «de transacción» que resuelve getRepository por
 *   entidad, y un `manager` raíz cuyo `.transaction()` corre el callback con él.
 *   Así se puede afirmar que las escrituras fueron por la transacción (y no por los
 *   repos inyectados) y que un error dentro del callback llega al llamador.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type FakeQb = Record<string, jest.Mock>;

export function fakeQb(result?: {
  getOne?: unknown;
  getMany?: unknown[];
  execute?: unknown;
}): FakeQb {
  const qb: FakeQb = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orWhere',
    'orderBy',
    'addOrderBy',
    'setLock',
    'update',
    'set',
    'delete',
    'from',
    'innerJoinAndSelect',
    'leftJoinAndSelect',
    'groupBy',
    'skip',
    'take',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getOne = jest.fn().mockResolvedValue(result?.getOne ?? null);
  qb.getMany = jest.fn().mockResolvedValue(result?.getMany ?? []);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.execute = jest.fn().mockResolvedValue(result?.execute ?? { affected: 1 });
  return qb;
}

export function fakeRepo(overrides: Record<string, any> = {}, target?: unknown): any {
  const qb = fakeQb();
  return {
    target,
    qb,
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => ({ ...(x as object) })),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    softRemove: jest.fn(async (x: unknown) => x),
    softDelete: jest.fn().mockResolvedValue({ affected: 0 }),
    remove: jest.fn(async (x: unknown) => x),
    query: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() => qb),
    ...overrides,
  };
}

export function fakeTx(repos: Map<unknown, any>) {
  const txManager: any = {
    queryRunner: { isTransactionActive: true },
    getRepository: jest.fn((entity: unknown) => {
      const repo = repos.get(entity);
      if (!repo)
        throw new Error(`fakeTx: sin repo para ${String((entity as any)?.name ?? entity)}`);
      return repo;
    }),
  };
  const rootManager: any = {
    transaction: jest.fn(async (isoOrFn: unknown, maybeFn?: (m: unknown) => unknown) => {
      const fn = (typeof isoOrFn === 'function' ? isoOrFn : maybeFn) as (m: unknown) => unknown;
      return fn(txManager);
    }),
  };
  return { txManager, rootManager };
}
