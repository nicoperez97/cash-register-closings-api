import {
  findCashShortcutOrphan,
  movementChannelKey,
  sameMovementEconomics,
  sameWithdrawalEconomics,
} from './closing-movements-diff.util';

describe('movementChannelKey', () => {
  it('keeps PVS label variants on the same card lane', () => {
    expect(movementChannelKey('PVS')).toBe('card');
    expect(movementChannelKey('PVS / Tarjeta')).toBe('card');
  });

  it('does not collapse cash income, withdrawal and change into one key', () => {
    expect(movementChannelKey('Efectivo del día')).toBe('cash_income');
    expect(movementChannelKey('Efectivo — Nike')).toBe('cash_withdrawal');
    expect(movementChannelKey('Efectivo - Onse')).toBe('cash_withdrawal');
    expect(movementChannelKey('Cambio en caja — Toma')).toBe('cash_change');
  });

  it('still maps the cash account name to a generic cash key', () => {
    expect(movementChannelKey('Efectivo Caja')).toBe('cash');
  });

  it('keeps dividend transfers on their own lane', () => {
    expect(movementChannelKey('Dividendo · Nike → Onse')).toBe('dividend');
    expect(movementChannelKey('Dividendo · Toma')).toBe('dividend');
  });
});

describe('sameMovementEconomics', () => {
  it('treats same accounts and amount as equal even with different labels', () => {
    expect(
      sameMovementEconomics(
        { fromAccountId: 'ing', toAccountId: 'pvs', amountUyu: '66550.00' },
        { fromAccountId: 'ing', toAccountId: 'pvs', amountUyu: 66550 },
      ),
    ).toBe(true);
  });

  it('detects amount or account differences', () => {
    expect(
      sameMovementEconomics(
        { fromAccountId: 'ing', toAccountId: 'pvs', amountUyu: 66550 },
        { fromAccountId: 'ing', toAccountId: 'pvs', amountUyu: 66551 },
      ),
    ).toBe(false);
    expect(
      sameMovementEconomics(
        { fromAccountId: 'ing', toAccountId: 'pvs', amountUyu: 66550 },
        { fromAccountId: 'ing', toAccountId: 'mp', amountUyu: 66550 },
      ),
    ).toBe(false);
  });
});

describe('sameWithdrawalEconomics', () => {
  it('matches partner withdrawals even if cash source account differs', () => {
    expect(
      sameWithdrawalEconomics(
        {
          description: 'Efectivo — Nike',
          toAccountId: 'nike',
          amountUyu: 100000,
        },
        {
          description: 'Efectivo - Nike',
          toAccountId: 'nike',
          amountUyu: '100000.00',
        },
      ),
    ).toBe(true);
  });

  it('does not match incomes or different partners', () => {
    expect(
      sameWithdrawalEconomics(
        { description: 'Efectivo del día', toAccountId: 'cash', amountUyu: 100000 },
        { description: 'Efectivo — Nike', toAccountId: 'nike', amountUyu: 100000 },
      ),
    ).toBe(false);
    expect(
      sameWithdrawalEconomics(
        { description: 'Efectivo — Nike', toAccountId: 'nike', amountUyu: 100000 },
        { description: 'Efectivo — Onse', toAccountId: 'onse', amountUyu: 100000 },
      ),
    ).toBe(false);
  });
});

describe('findCashShortcutOrphan', () => {
  const isIngreso = (m: { fromAccount?: { code?: string | null } | null }) =>
    m.fromAccount?.code === 'INGRESO';

  it('matches exact amount first', () => {
    const unused = new Set(['a', 'b']);
    const hit = findCashShortcutOrphan(
      [
        { id: 'a', toAccountId: 'onse', amountUyu: 476000, fromAccount: { code: 'INGRESO' } },
        { id: 'b', toAccountId: 'onse', amountUyu: 466000, fromAccount: { code: 'INGRESO' } },
      ],
      unused,
      'onse',
      [466000],
      isIngreso,
    );
    expect(hit?.id).toBe('b');
  });

  it('accepts small relative amount drift', () => {
    const unused = new Set(['a']);
    const hit = findCashShortcutOrphan(
      [{ id: 'a', toAccountId: 'onse', amountUyu: 476000, fromAccount: { code: 'INGRESO' } }],
      unused,
      'onse',
      [466000],
      isIngreso,
    );
    expect(hit?.id).toBe('a');
  });
});
