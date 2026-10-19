/**
 * Flujos de plata atómicos (sin DB): cierres, A Retirar y pagos.
 *
 * Los repos inyectados y los de la transacción son dobles distintos, así se puede
 * afirmar que las escrituras fueron por la transacción y que, si un paso falla, el
 * error llega al llamador (rollback) sin efectos posteriores (propinas, avisos…).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClosingsService } from '../src/modules/closings/closings.service';
import { CashWithdrawalsService } from '../src/modules/closings/cash-withdrawals.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { CashClosing } from '../src/entities/cash-closing.entity';
import { ClosingExpense } from '../src/entities/closing-expense.entity';
import { ClosingExtraLine } from '../src/entities/closing-extra-line.entity';
import { ClosingSourceAmount } from '../src/entities/closing-source-amount.entity';
import { CashPendingWithdrawal } from '../src/entities/cash-pending-withdrawal.entity';
import { CashPendingWithdrawalOffset } from '../src/entities/cash-pending-withdrawal-offset.entity';
import { Payment } from '../src/entities/payment.entity';
import { AuthUser } from '../src/common/decorators';
import {
  CashPendingWithdrawalStatus,
  ClosingKind,
  ClosingStatus,
  GlobalRole,
  PaymentMethod,
  PaymentStatus,
} from '../src/common/enums';
import { closingDateKey } from '../src/common/soft-delete.util';
import { fakeQb, fakeRepo, fakeTx } from './helpers/fake-tx';

const SHOP = 'shop-1';
const SHIFT = {
  id: 'shift-1',
  name: 'Noche',
  opensAt: '19:00',
  closesAt: '23:59',
};

function ownerUser(): AuthUser {
  return {
    id: 'u-owner',
    email: 'owner@test.local',
    fullName: 'Owner Test',
    globalRole: GlobalRole.OWNER,
    shopIds: [SHOP],
    shopRoles: { [SHOP]: GlobalRole.OWNER },
    shopAccountIds: {},
    shopModulePermissions: {},
    shopPermissions: {},
    permissions: [],
  } as unknown as AuthUser;
}

function draftClosing(overrides: Partial<CashClosing> = {}): CashClosing {
  return {
    id: 'c-1',
    shopId: SHOP,
    businessDate: '2026-10-18',
    businessDateKey: closingDateKey('2026-10-18', SHIFT.id),
    shiftId: SHIFT.id,
    shiftName: SHIFT.name,
    kind: ClosingKind.REGULAR,
    status: ClosingStatus.DRAFT,
    posSystemAmount: '1000.00',
    cashAmount: '1000.00',
    cashOpeningAmount: '0.00',
    cashLeftInRegister: '0.00',
    cashPendingPickup: '0.00',
    cashWithdrawn: '0.00',
    expenses: [],
    extraLines: [],
    sourceAmounts: [],
    active: true,
    ...overrides,
  } as unknown as CashClosing;
}

function buildClosings() {
  const txClosings = fakeRepo({}, CashClosing);
  const txExpenses = fakeRepo({}, ClosingExpense);
  const txExtras = fakeRepo({}, ClosingExtraLine);
  const txSourceAmounts = fakeRepo({}, ClosingSourceAmount);
  const { txManager, rootManager } = fakeTx(
    new Map<unknown, any>([
      [CashClosing, txClosings],
      [ClosingExpense, txExpenses],
      [ClosingExtraLine, txExtras],
      [ClosingSourceAmount, txSourceAmounts],
    ]),
  );
  const closings = fakeRepo({ manager: rootManager }, CashClosing);
  const expenses = fakeRepo({}, ClosingExpense);
  const extras = fakeRepo({}, ClosingExtraLine);
  const sources = fakeRepo();
  const sourceAmounts = fakeRepo({}, ClosingSourceAmount);
  const shops = {
    assertShopAccess: jest.fn(),
    getShopEntity: jest.fn().mockResolvedValue({
      id: SHOP,
      shifts: [SHIFT],
      openingTime: '19:00',
      timezone: 'America/Montevideo',
      differenceReasonMinAmount: 0,
    }),
    setOrderingOpen: jest.fn().mockResolvedValue(undefined),
  };
  const closingMovements = {
    ensureCatalogs: jest.fn().mockResolvedValue(undefined),
    syncFromClosing: jest.fn().mockResolvedValue(undefined),
    removeFromClosing: jest.fn().mockResolvedValue(undefined),
  };
  const cashWithdrawals = {
    syncFromClosing: jest.fn().mockResolvedValue(undefined),
    cancelForClosing: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { createMany: jest.fn().mockResolvedValue(undefined) };
  const stepFiles = {
    listForClosing: jest.fn().mockResolvedValue([]),
    deleteForClosing: jest.fn().mockResolvedValue(undefined),
  };
  const tips = { syncFromClosing: jest.fn().mockResolvedValue(null) };
  const service = new ClosingsService(
    closings,
    expenses,
    extras,
    sources,
    sourceAmounts,
    fakeRepo(), // users
    fakeRepo(), // employees
    fakeRepo(), // userShops
    fakeRepo(), // shopRepo
    shops as any,
    closingMovements as any,
    { resolvePartnerAccountForUser: jest.fn() } as any,
    notifications as any,
    cashWithdrawals as any,
    stepFiles as any,
    tips as any,
  );
  return {
    service,
    closings,
    expenses,
    sourceAmounts,
    txClosings,
    txExpenses,
    txManager,
    rootManager,
    shops,
    closingMovements,
    cashWithdrawals,
    notifications,
    stepFiles,
    tips,
  };
}

/** lockEntity (FOR UPDATE) + recarga con hijos dentro de la transacción. */
function lockReturns(ctx: ReturnType<typeof buildClosings>, row: CashClosing | null) {
  ctx.txClosings.createQueryBuilder.mockImplementation(() => fakeQb({ getOne: row }));
  ctx.txClosings.findOne.mockResolvedValue(row);
}

describe('ClosingsService · transacciones', () => {
  it('update: cierre + hijos + libro van por la misma transacción', async () => {
    const ctx = buildClosings();
    const row = draftClosing();
    lockReturns(ctx, row);
    ctx.closings.findOne.mockResolvedValue(row); // getOne final

    await ctx.service.update(ownerUser(), SHOP, row.id, {
      cashAmount: 1200,
      expenses: [{ label: 'Hielo', amount: 50 }],
    } as any);

    expect(ctx.rootManager.transaction).toHaveBeenCalledWith(
      'READ COMMITTED',
      expect.any(Function),
    );
    const lockQb = ctx.txClosings.createQueryBuilder.mock.results[0].value;
    expect(lockQb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(ctx.txClosings.save).toHaveBeenCalled();
    expect(ctx.txExpenses.delete).toHaveBeenCalledWith({ closingId: row.id });
    expect(ctx.txExpenses.save).toHaveBeenCalled();
    expect(ctx.closingMovements.syncFromClosing).toHaveBeenCalledWith(row, ctx.txManager);
    expect(ctx.cashWithdrawals.syncFromClosing).toHaveBeenCalledWith(row, ctx.txManager);
    // Nada se escribió por los repos fuera de la transacción.
    expect(ctx.closings.save).not.toHaveBeenCalled();
    expect(ctx.expenses.delete).not.toHaveBeenCalled();
    expect(ctx.expenses.save).not.toHaveBeenCalled();
    // Envío del borrador: efectos después del COMMIT.
    expect(ctx.tips.syncFromClosing).toHaveBeenCalled();
    expect(ctx.shops.setOrderingOpen).toHaveBeenCalledWith(SHOP, false);
  });

  it('update: si falla el sync de A Retirar, el error llega y no hay efectos posteriores', async () => {
    const ctx = buildClosings();
    const row = draftClosing();
    lockReturns(ctx, row);
    ctx.cashWithdrawals.syncFromClosing.mockRejectedValue(new Error('deadlock'));

    await expect(
      ctx.service.update(ownerUser(), SHOP, row.id, {
        cashAmount: 1200,
      } as any),
    ).rejects.toThrow('deadlock');

    expect(ctx.tips.syncFromClosing).not.toHaveBeenCalled();
    expect(ctx.shops.setOrderingOpen).not.toHaveBeenCalled();
    expect(ctx.notifications.createMany).not.toHaveBeenCalled();
  });

  it('update: doble envío — el segundo ve el cierre ya SUBMITTED y no re-notifica', async () => {
    const ctx = buildClosings();
    const row = draftClosing({ status: ClosingStatus.SUBMITTED });
    lockReturns(ctx, row);
    ctx.closings.findOne.mockResolvedValue(row);

    await ctx.service.update(ownerUser(), SHOP, row.id, {
      cashAmount: 1000,
    } as any);

    expect(ctx.shops.setOrderingOpen).not.toHaveBeenCalled();
    expect(ctx.notifications.createMany).not.toHaveBeenCalled();
    expect(row.status).toBe(ClosingStatus.SUBMITTED);
  });

  it('update: cierre inexistente o borrado → 404 sin escribir', async () => {
    const ctx = buildClosings();
    lockReturns(ctx, null);
    await expect(
      ctx.service.update(ownerUser(), SHOP, 'nope', { cashAmount: 1 } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.txClosings.save).not.toHaveBeenCalled();
  });

  it('create: doble envío concurrente (índice único) → 409 y sin propinas', async () => {
    const ctx = buildClosings();
    ctx.closings.findOne.mockResolvedValue(null); // no existe al chequear
    ctx.txClosings.save.mockRejectedValue(
      Object.assign(new Error('Duplicate entry'), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      }),
    );

    await expect(
      ctx.service.create(ownerUser(), SHOP, {
        businessDate: '2026-10-18',
        shiftId: SHIFT.id,
        posSystemAmount: 1000,
        cashAmount: 1000,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.closingMovements.syncFromClosing).not.toHaveBeenCalled();
    expect(ctx.tips.syncFromClosing).not.toHaveBeenCalled();
  });

  it('remove: libro, A Retirar, hijos y baja en una transacción; adjuntos después', async () => {
    const ctx = buildClosings();
    const row = draftClosing({ status: ClosingStatus.SUBMITTED });
    lockReturns(ctx, row);

    await ctx.service.remove(ownerUser(), SHOP, row.id);

    expect(ctx.closingMovements.removeFromClosing).toHaveBeenCalledWith(row.id, ctx.txManager);
    expect(ctx.cashWithdrawals.cancelForClosing).toHaveBeenCalledWith(row.id, ctx.txManager);
    expect(ctx.txExpenses.delete).toHaveBeenCalledWith({ closingId: row.id });
    expect(ctx.txClosings.softRemove).toHaveBeenCalledWith(row);
    expect(ctx.closings.softRemove).not.toHaveBeenCalled();
    expect(ctx.stepFiles.deleteForClosing).toHaveBeenCalledWith(SHOP, row.id);
  });

  it('remove: si falla a mitad no se borran los adjuntos del disco', async () => {
    const ctx = buildClosings();
    lockReturns(ctx, draftClosing());
    ctx.cashWithdrawals.cancelForClosing.mockRejectedValue(new Error('lock wait timeout'));

    await expect(ctx.service.remove(ownerUser(), SHOP, 'c-1')).rejects.toThrow('lock wait timeout');
    expect(ctx.txClosings.softRemove).not.toHaveBeenCalled();
    expect(ctx.stepFiles.deleteForClosing).not.toHaveBeenCalled();
  });
});

describe('CashWithdrawalsService.pick · doble retiro', () => {
  function build(lockedStatus: CashPendingWithdrawalStatus) {
    const pendingRow = {
      id: 'p-1',
      shopId: SHOP,
      closingId: 'c-1',
      status: CashPendingWithdrawalStatus.PENDING,
      active: true,
      amount: '500.00',
    };
    const txPending = fakeRepo({}, CashPendingWithdrawal);
    txPending.createQueryBuilder.mockImplementation(() =>
      fakeQb({ getMany: [{ ...pendingRow, status: lockedStatus }] }),
    );
    const txClosings = fakeRepo({}, CashClosing);
    txClosings.findOne.mockResolvedValue(draftClosing({ status: ClosingStatus.SUBMITTED }));
    const txOffsets = fakeRepo({}, CashPendingWithdrawalOffset);
    const { txManager, rootManager } = fakeTx(
      new Map<unknown, any>([
        [CashPendingWithdrawal, txPending],
        [CashClosing, txClosings],
        [CashPendingWithdrawalOffset, txOffsets],
      ]),
    );
    const pending = fakeRepo({ manager: rootManager }, CashPendingWithdrawal);
    pending.find.mockResolvedValue([pendingRow]);
    const closings = fakeRepo({}, CashClosing);
    const users = fakeRepo();
    users.findOne.mockResolvedValue({
      id: 'u-partner',
      fullName: 'Socio',
      active: true,
    });
    const userShops = fakeRepo();
    userShops.findOne.mockResolvedValue({ shopId: SHOP, userId: 'u-partner' });
    const closingMovements = {
      ensureCatalogs: jest.fn().mockResolvedValue(undefined),
      syncFromClosing: jest.fn().mockResolvedValue(undefined),
    };
    const live = { tick: jest.fn() };
    const service = new CashWithdrawalsService(
      pending,
      fakeRepo({}, CashPendingWithdrawalOffset),
      closings,
      fakeRepo(), // movements
      fakeRepo(), // ledger
      users,
      userShops,
      fakeRepo(), // shopRepo
      { assertShopAccess: jest.fn() } as any,
      {
        resolvePartnerAccountForUser: jest.fn().mockResolvedValue({ id: 'acc-1', name: 'Socio' }),
      } as any,
      closingMovements as any,
      { createMany: jest.fn().mockResolvedValue(undefined) } as any,
      live as any,
    );
    jest.spyOn(service as any, 'computePendingView').mockResolvedValue({
      items: [{ id: 'p-1', remainingAmount: 500, allocations: [] }],
    });
    jest.spyOn(service as any, 'cashDrawerAccountName').mockResolvedValue('Caja');
    return {
      service,
      txPending,
      txClosings,
      closings,
      closingMovements,
      txManager,
    };
  }

  it('retira bajo FOR UPDATE y sincroniza el libro en la misma transacción', async () => {
    const ctx = build(CashPendingWithdrawalStatus.PENDING);
    await expect(
      ctx.service.pick(ownerUser(), SHOP, {
        ids: ['p-1'],
        userId: 'u-partner',
      } as any),
    ).resolves.toMatchObject({ ok: true, picked: 1 });
    const lockQb = ctx.txPending.createQueryBuilder.mock.results[0].value;
    expect(lockQb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(ctx.txClosings.save).toHaveBeenCalled();
    expect(ctx.closingMovements.syncFromClosing).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-1' }),
      ctx.txManager,
    );
    expect(ctx.txPending.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CashPendingWithdrawalStatus.PICKED }),
    );
    expect(ctx.closings.save).not.toHaveBeenCalled();
  });

  it('si otro request ya lo retiró, falla sin tocar cierre ni libro', async () => {
    const ctx = build(CashPendingWithdrawalStatus.PICKED);
    await expect(
      ctx.service.pick(ownerUser(), SHOP, {
        ids: ['p-1'],
        userId: 'u-partner',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.txClosings.save).not.toHaveBeenCalled();
    expect(ctx.closingMovements.syncFromClosing).not.toHaveBeenCalled();
    expect(ctx.txPending.save).not.toHaveBeenCalled();
  });
});

describe('PaymentsService · pagar / revertir', () => {
  function build(paymentRow: Partial<Payment>, claimAffected = 1) {
    const txPayments = fakeRepo({}, Payment);
    txPayments.createQueryBuilder.mockImplementation(() =>
      fakeQb({ execute: { affected: claimAffected } }),
    );
    const { txManager, rootManager } = fakeTx(new Map<unknown, any>([[Payment, txPayments]]));
    const payments = fakeRepo({ manager: rootManager }, Payment);
    payments.findOne.mockResolvedValue({
      id: 'pay-1',
      shopId: SHOP,
      active: true,
      amount: '300.00',
      title: 'Proveedor',
      ...paymentRow,
    });
    const accounts = fakeRepo();
    accounts.findOne.mockResolvedValue({
      id: 'acc-caja',
      shopId: SHOP,
      active: true,
      code: 'CAJA',
    });
    const movements = {
      create: jest.fn().mockResolvedValue({ id: 'mov-1' }),
      remove: jest.fn().mockResolvedValue({ ok: true }),
    };
    const service = new PaymentsService(
      payments,
      accounts,
      fakeRepo(), // users
      fakeRepo(), // userShops
      fakeRepo(), // suppliers
      fakeRepo(), // employees
      fakeRepo(), // shopServices
      fakeRepo(), // concepts
      {
        assertShopAccess: jest.fn(),
        getShopEntity: jest.fn().mockResolvedValue({ id: SHOP }),
      } as any,
      { create: jest.fn(), createMany: jest.fn() } as any,
      movements as any,
      {} as any,
    );
    jest.spyOn(service as any, 'assertAccount').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'resolvePaidDestinationAccountId').mockResolvedValue('acc-egreso');
    jest.spyOn(service as any, 'notifyAdminsPaymentPaid').mockResolvedValue(undefined);
    return { service, payments, txPayments, txManager, movements };
  }

  it('pay: claim, egreso y link en la misma transacción', async () => {
    const ctx = build({
      status: PaymentStatus.VALIDATED,
      accountId: 'acc-caja',
      paymentMethod: PaymentMethod.CASH,
    });
    await ctx.service.pay(ownerUser(), SHOP, 'pay-1', { paidAt: '2026-10-18' });
    expect(ctx.movements.create).toHaveBeenCalledWith(
      expect.anything(),
      SHOP,
      expect.objectContaining({ amountUyu: 300 }),
      expect.objectContaining({ fromPayment: true, manager: ctx.txManager }),
    );
    expect(ctx.txPayments.createQueryBuilder).toHaveBeenCalledTimes(2); // claim + movementId
    expect(ctx.payments.update).not.toHaveBeenCalled();
  });

  it('pay: si falla el egreso, el error sube y no hay «compensación» fuera de la transacción', async () => {
    const ctx = build({
      status: PaymentStatus.VALIDATED,
      accountId: 'acc-caja',
      paymentMethod: PaymentMethod.CASH,
    });
    ctx.movements.create.mockRejectedValue(new Error('cuenta inactiva'));
    await expect(
      ctx.service.pay(ownerUser(), SHOP, 'pay-1', { paidAt: '2026-10-18' }),
    ).rejects.toThrow('cuenta inactiva');
    expect(ctx.payments.update).not.toHaveBeenCalled();
    expect(ctx.payments.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('pay: doble clic — el segundo claim no afecta filas y no crea otro egreso', async () => {
    const ctx = build(
      {
        status: PaymentStatus.VALIDATED,
        accountId: 'acc-caja',
        paymentMethod: PaymentMethod.CASH,
      },
      0,
    );
    await expect(
      ctx.service.pay(ownerUser(), SHOP, 'pay-1', { paidAt: '2026-10-18' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.movements.create).not.toHaveBeenCalled();
  });

  it('revertStatus: baja del egreso y estado juntos; un error real deshace todo', async () => {
    const ctx = build({ status: PaymentStatus.PAID, movementId: 'mov-1' });
    ctx.movements.remove.mockRejectedValue(new Error('lock wait timeout'));
    await expect(ctx.service.revertStatus(ownerUser(), SHOP, 'pay-1')).rejects.toThrow(
      'lock wait timeout',
    );
    expect(ctx.movements.remove).toHaveBeenCalledWith(
      expect.anything(),
      SHOP,
      'mov-1',
      expect.objectContaining({ fromPayment: true, manager: ctx.txManager }),
    );
  });

  it('revertStatus: si el egreso ya no existe, igual vuelve a «por pagar»', async () => {
    const ctx = build({ status: PaymentStatus.PAID, movementId: 'mov-1' });
    ctx.movements.remove.mockRejectedValue(new NotFoundException('Movimiento no encontrado'));
    await expect(ctx.service.revertStatus(ownerUser(), SHOP, 'pay-1')).resolves.toBeDefined();
  });

  it('revertStatus: doble clic — si ya no está PAID no intenta borrar el egreso', async () => {
    const ctx = build({ status: PaymentStatus.PAID, movementId: 'mov-1' }, 0);
    await expect(ctx.service.revertStatus(ownerUser(), SHOP, 'pay-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.movements.remove).not.toHaveBeenCalled();
  });
});
