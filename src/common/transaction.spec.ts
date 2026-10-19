import { ConflictException } from '@nestjs/common';
import { MONEY_TX_ISOLATION, moneyTransaction, repoFor, withAdvisoryLock } from './transaction';

describe('transaction helpers', () => {
  it('repoFor usa el repo del manager si hay transacción', () => {
    const own = { target: 'Movement' } as never;
    const txRepo = { tx: true };
    const manager = { getRepository: jest.fn(() => txRepo) } as never;
    expect(repoFor(own, manager)).toBe(txRepo);
    expect(repoFor(own, null)).toBe(own);
  });

  it('moneyTransaction abre READ COMMITTED y reusa una transacción activa', async () => {
    const root = {
      transaction: jest.fn(async (_iso: string, fn: (m: unknown) => unknown) => fn('tx')),
    };
    await expect(moneyTransaction(root as never, async (m) => m)).resolves.toBe('tx');
    expect(root.transaction).toHaveBeenCalledWith(MONEY_TX_ISOLATION, expect.any(Function));

    root.transaction.mockClear();
    const outer = { queryRunner: { isTransactionActive: true } };
    await expect(moneyTransaction(root as never, async (m) => m, outer as never)).resolves.toBe(
      outer,
    );
    expect(root.transaction).not.toHaveBeenCalled();
  });

  function fakeRunner(lockOk: number) {
    const calls: string[] = [];
    const qr = {
      connect: jest.fn(async () => calls.push('connect')),
      release: jest.fn(async () => calls.push('release')),
      query: jest.fn(async (sql: string) => {
        calls.push(sql.startsWith('SELECT GET_LOCK') ? 'get_lock' : 'release_lock');
        return [{ ok: lockOk }];
      }),
      manager: {
        transaction: jest.fn(async (_iso: string, fn: (m: unknown) => unknown) => {
          calls.push('tx');
          return fn('tx-manager');
        }),
      },
    };
    const manager = { connection: { createQueryRunner: () => qr } };
    return { qr, manager, calls };
  }

  it('withAdvisoryLock suelta el lock después de la transacción', async () => {
    const { manager, calls, qr } = fakeRunner(1);
    await expect(
      withAdvisoryLock(manager as never, 'partner-split:shop-1', async (m) => m),
    ).resolves.toBe('tx-manager');
    expect(calls).toEqual(['connect', 'get_lock', 'tx', 'release_lock', 'release']);
    expect(qr.manager.transaction).toHaveBeenCalledWith(MONEY_TX_ISOLATION, expect.any(Function));
  });

  it('withAdvisoryLock suelta el lock aunque la operación falle', async () => {
    const { manager, calls } = fakeRunner(1);
    await expect(
      withAdvisoryLock(manager as never, 'k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls).toEqual(['connect', 'get_lock', 'tx', 'release_lock', 'release']);
  });

  it('withAdvisoryLock devuelve 409 si otro request tiene el lock', async () => {
    const { manager, calls, qr } = fakeRunner(0);
    const fn = jest.fn();
    await expect(withAdvisoryLock(manager as never, 'k', fn)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(qr.manager.transaction).not.toHaveBeenCalled();
    expect(calls).toEqual(['connect', 'get_lock', 'release']);
  });
});
