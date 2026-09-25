import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { Shop } from '../../entities/shop.entity';
import { CashPendingWithdrawal } from '../../entities/cash-pending-withdrawal.entity';
import {
  LinkedPaymentMethod,
  ClosingSourceKind,
  ClosingSourceRole,
  LedgerAccountType,
  CashPendingWithdrawalStatus,
} from '../../common/enums';
import { EXPENSE_CATEGORY_TO_CONCEPT, findCashDrawerAccount } from '../../common/catalog-seed';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { resolveShopBusinessDate } from '../../common/business-date';
import { isLiveClosingMovement } from './movement-query.util';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class ClosingMovementsSyncService {
  constructor(
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    @InjectRepository(CashClosing)
    private readonly closings: Repository<CashClosing>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(CashPendingWithdrawal)
    private readonly pendingWithdrawals: Repository<CashPendingWithdrawal>,
    @InjectRepository(ShopClosingSource)
    private readonly closingSources: Repository<ShopClosingSource>,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  /** Anula los movimientos del cierre (p. ej. al eliminarlo) sin volver a generarlos. */
  async removeFromClosing(closingId: string): Promise<void> {
    await this.movements.update({ closingId }, { active: false });
    await this.movements.softDelete({ closingId });
  }

  async syncFromClosing(closing: CashClosing) {
    await this.movements.delete({ closingId: closing.id });

    await this.catalogSeed.ensureShopCatalogs(closing.shopId);

    const accounts = await this.accounts.find({ where: { shopId: closing.shopId } });
    if (!accounts.length) return;
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    const ingreso = byCode.get('INGRESO');
    const egreso = byCode.get('EGRESO');
    if (!ingreso || !egreso) return;

    const concepts = await this.concepts.find({
      where: { shopId: closing.shopId },
    });
    const conceptByName = new Map(
      concepts.filter((c) => c.active !== false).map((c) => [c.name, c]),
    );

    const findConcept = (name: string) => conceptByName.get(name)?.id ?? null;

    const rows: Partial<Movement>[] = [];
    const date = closing.businessDate;
    const shop = await this.shops.findOne({ where: { id: closing.shopId } });
    const withdrawalDate = await this.resolveWithdrawalBusinessDate(closing, shop);

    const ingresoAccount = ingreso;

    // Efectivo del día → cuenta destino de la cuenta del local CASH (o fallback drawer).
    const cashSourceCfg = await this.closingSources.findOne({
      where: { shopId: closing.shopId, role: ClosingSourceRole.CASH, active: true },
    });
    let cashDest =
      (cashSourceCfg?.accountId
        ? accounts.find((a) => a.id === cashSourceCfg.accountId)
        : null) ??
      accounts.find((a) => a.active && a.linkedPaymentMethod === LinkedPaymentMethod.CASH) ??
      findCashDrawerAccount(accounts) ??
      accounts.find((a) => a.active && a.code === 'EFECTIVO') ??
      null;
    // Recaudación = contado − apertura + egresos (el arqueo ya viene neto de gastos).
    const expensesTotal = (closing.expenses ?? []).reduce((s, e) => s + n(e.amount), 0);
    const cashIncome =
      n(closing.cashAmount) - n(closing.cashOpeningAmount) + expensesTotal;
    if (cashIncome > 0 && cashDest) {
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: ingresoAccount.id,
        toAccountId: cashDest.id,
        description: 'Efectivo del día',
        amountUyu: money(cashIncome),
        conceptId: findConcept('EFECTIVO ingreso'),
        closingId: closing.id,
        invoiced: false,
        active: true,
      });
    }

    // Cuentas del local (OWN_ACCOUNT): un asiento por source con monto > 0.
    // Compat legacy: si aún hay montos en columnas canal y no hay sourceAmounts, usar linkedPaymentMethod.
    const sourceRows = closing.sourceAmounts ?? [];
    for (const src of sourceRows) {
      const amount = n(src.amount);
      if (amount <= 0) continue;
      if (String(src.role ?? '') === 'CASH') continue;
      if (src.kind !== ClosingSourceKind.OWN_ACCOUNT || !src.accountId) continue;
      const dest = accounts.find((a) => a.id === src.accountId);
      if (!dest) continue;
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: ingresoAccount.id,
        toAccountId: dest.id,
        description: src.name,
        amountUyu: money(amount),
        conceptId: findConcept('Cobro') ?? findConcept('Ingreso'),
        closingId: closing.id,
        invoiced: false,
        active: true,
      });
    }

    // Legacy: columnas canal / other cuando no hay sourceAmounts (cierres históricos).
    if (!sourceRows.length) {
      const byMethod = new Map<string, LedgerAccount>();
      for (const a of accounts) {
        if (!a.active || !a.linkedPaymentMethod) continue;
        byMethod.set(a.linkedPaymentMethod, a);
      }
      const pushIncome = (
        method: LinkedPaymentMethod,
        amount: number,
        label: string,
        conceptName: string,
      ) => {
        if (amount <= 0) return;
        const channel = byMethod.get(method);
        if (!channel) return;
        rows.push({
          shopId: closing.shopId,
          businessDate: date,
          fromAccountId: ingreso.id,
          toAccountId: channel.id,
          description: label,
          amountUyu: money(amount),
          conceptId: findConcept(conceptName),
          closingId: closing.id,
          invoiced: false,
          active: true,
        });
      };
      pushIncome(LinkedPaymentMethod.CARD, n(closing.cardAmount), 'PVS / Tarjeta', 'Cobro');
      pushIncome(
        LinkedPaymentMethod.MERCADO_PAGO,
        n(closing.mercadoPagoAmount),
        'Mercado Pago',
        'Cobro',
      );
      pushIncome(LinkedPaymentMethod.DELIVERY, n(closing.deliveryAppsAmount), 'Delivery', 'Cobro');
      pushIncome(LinkedPaymentMethod.TRANSFER, n(closing.transferAmount), 'Transferencia', 'Cobro');
      pushIncome(
        LinkedPaymentMethod.ACCOUNT_DNI,
        n(closing.accountDniAmount),
        'Cuenta DNI',
        'Cobro',
      );
      if (n(closing.otherAmount) > 0) {
        pushIncome(LinkedPaymentMethod.OTHER, n(closing.otherAmount), 'Otros ingresos', 'Ingreso');
      }
    } else if (n(closing.otherAmount) > 0) {
      // Cobros libres no-CASH: asiento si hay cuenta "Otros" OWN_ACCOUNT o linked OTHER.
      const otros = sourceRows.find(
        (s) =>
          s.kind === ClosingSourceKind.OWN_ACCOUNT &&
          s.accountId &&
          /otros/i.test(s.name),
      );
      const dest =
        (otros?.accountId ? accounts.find((a) => a.id === otros.accountId) : null) ??
        accounts.find((a) => a.active && a.linkedPaymentMethod === LinkedPaymentMethod.OTHER) ??
        null;
      if (dest) {
        rows.push({
          shopId: closing.shopId,
          businessDate: date,
          fromAccountId: ingresoAccount.id,
          toAccountId: dest.id,
          description: 'Otros ingresos',
          amountUyu: money(n(closing.otherAmount)),
          conceptId: findConcept('Ingreso'),
          closingId: closing.id,
          invoiced: false,
          active: true,
        });
      }
    }

    const cashChannel = cashDest;
    const cashDrawer = findCashDrawerAccount(accounts) ?? cashChannel;

    // Efectivo Caja → cuenta de quien se lo lleva (PARTNER).
    let partnerDestId: string | null = null;
    if (closing.cashWithdrawnToAccountId) {
      const dest = accounts.find((a) => a.id === closing.cashWithdrawnToAccountId);
      if (dest) partnerDestId = dest.id;
    } else if (closing.cashWithdrawnByName) {
      const partner = accounts.find(
        (a) =>
          a.active &&
          a.type === 'PARTNER' &&
          a.name.toLowerCase() === closing.cashWithdrawnByName!.trim().toLowerCase(),
      );
      if (partner) partnerDestId = partner.id;
    }

    // A retirar = contado − cambio (los egresos ya salieron antes del recuento).
    const cashTake =
      n(closing.cashWithdrawn) > 0
        ? n(closing.cashWithdrawn)
        : Math.max(0, n(closing.cashAmount) - n(closing.cashLeftInRegister));

    if (cashDrawer && partnerDestId && cashTake > 0) {
      rows.push({
        shopId: closing.shopId,
        businessDate: withdrawalDate,
        fromAccountId: cashDrawer.id,
        toAccountId: partnerDestId,
        description: `Efectivo — ${closing.cashWithdrawnByName ?? 'retiro'}`,
        amountUyu: money(cashTake),
        conceptId: this.resolveWithdrawalConceptId(shop, concepts, findConcept),
        closingId: closing.id,
        employeeId: closing.cashWithdrawnByEmployeeId ?? null,
        invoiced: false,
        active: true,
      });
    }

    for (const exp of closing.expenses ?? []) {
      const amount = n(exp.amount);
      if (amount <= 0) continue;
      const conceptName =
        EXPENSE_CATEGORY_TO_CONCEPT[exp.category] ?? 'Otros gastos';
      // Preferir el concepto elegido en el cierre (p.ej. tras unificar).
      // Fallback: mapa categoría → nombre seed.
      const conceptId =
        (exp.conceptId && concepts.find((c) => c.id === exp.conceptId)?.id) ||
        findConcept(conceptName);
      // Egresos salen del efectivo depositado; si no hay, de EGRESO no tiene sentido —
      // se omite el movimiento si no hay canal de efectivo configurado.
      if (!cashChannel) continue;
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: cashChannel.id,
        toAccountId: egreso.id,
        description: exp.label,
        amountUyu: money(amount),
        conceptId,
        closingId: closing.id,
        invoiced: false,
        active: true,
      });
    }

    if (rows.length) {
      await this.movements.save(rows.map((r) => this.movements.create(r)));
    }
  }

  /**
   * Fecha del retiro en sí: si se confirmó después (A retirar), usa esa fecha laboral.
   * Si se asignó quién en el momento del cierre, queda la fecha del cierre.
   */
  private async resolveWithdrawalBusinessDate(
    closing: CashClosing,
    shop: Shop | null,
  ): Promise<string> {
    const tz = {
      timezone: shop?.timezone,
      openingTime: shop?.openingTime,
    };
    const picked = await this.pendingWithdrawals.findOne({
      where: {
        closingId: closing.id,
        shopId: closing.shopId,
        status: CashPendingWithdrawalStatus.PICKED,
        active: true,
      },
      order: { pickedAt: 'DESC' },
    });
    if (picked?.pickedAt) {
      return resolveShopBusinessDate(new Date(picked.pickedAt), tz);
    }
    const stillPending = await this.pendingWithdrawals.findOne({
      where: {
        closingId: closing.id,
        shopId: closing.shopId,
        status: CashPendingWithdrawalStatus.PENDING,
        active: true,
      },
    });
    const hasWho = !!(
      closing.cashWithdrawnByUserId ||
      closing.cashWithdrawnByEmployeeId ||
      closing.cashWithdrawnToAccountId
    );
    if (stillPending && hasWho) {
      return resolveShopBusinessDate(new Date(), tz);
    }
    return closing.businessDate;
  }

  private resolveWithdrawalConceptId(
    shop: Shop | null,
    concepts: Concept[],
    findConcept: (name: string) => string | null,
  ): string | null {
    const configuredId = shop?.cashWithdrawalConceptId?.trim();
    if (configuredId) {
      const configured = concepts.find((c) => c.id === configuredId && c.active);
      if (configured) return configured.id;
    }
    return (
      findConcept('Utilidades') ??
      findConcept('Gastos varios') ??
      findConcept('Transferencia e/ cuentas')
    );
  }

  async previewMissingIncomes(shopId: string) {
    return this.reloadMissingIncomes(shopId, false);
  }

  async commitMissingIncomes(
    shopId: string,
    selected?: Array<{
      closingId: string;
      toAccountId: string;
      amount: number;
      label: string;
    }>,
  ) {
    return this.reloadMissingIncomes(shopId, true, selected);
  }

  private incomeItemKey(row: {
    closingId: string;
    toAccountId: string | null;
    label: string;
    amount: number;
  }) {
    return `${row.closingId}|${row.toAccountId ?? ''}|${row.label}|${row.amount}`;
  }

  private async reloadMissingIncomes(
    shopId: string,
    commit: boolean,
    selected?: Array<{
      closingId: string;
      toAccountId: string;
      amount: number;
      label: string;
    }>,
  ) {
    await this.catalogSeed.ensureShopCatalogs(shopId);
    const accounts = await this.accounts.find({ where: { shopId } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const ingreso = byCode.get('INGRESO');
    const closings = await this.closings.find({
      where: { shopId },
      relations: ['sourceAmounts', 'expenses'],
      order: { businessDate: 'ASC' },
    });
    const cashSourceCfg = await this.closingSources.findOne({
      where: { shopId, role: ClosingSourceRole.CASH, active: true },
    });
    const cashDest =
      (cashSourceCfg?.accountId
        ? accounts.find((a) => a.id === cashSourceCfg.accountId)
        : null) ??
      accounts.find((a) => a.active && a.linkedPaymentMethod === LinkedPaymentMethod.CASH) ??
      findCashDrawerAccount(accounts) ??
      null;
    const expected = ingreso
      ? this.expectedIncomes(closings, accounts, ingreso, cashDest)
      : [];

    const existing = await this.movements.find({
      where: { shopId, active: true },
      relations: ['fromAccount', 'toAccount', 'closing'],
    });
    const liveExisting = existing.filter((m) => isLiveClosingMovement(m));
    const incomePool = liveExisting.filter((m) => this.isIngresoAccount(m.fromAccount));
    const used = new Set<string>();
    const items = expected.map((row) => {
      if (!row.toAccountId) {
        return {
          ...row,
          status: 'skipped' as const,
          existingAmount: 0,
          existingDescription: null,
          existingMovementId: null as string | null,
        };
      }
      const exact = incomePool.find(
        (m) =>
          !used.has(m.id) &&
          m.businessDate === row.businessDate &&
          Number(m.amountUyu) === row.amount &&
          (m.toAccountId === row.toAccountId ||
            this.channelKey(m.toAccount?.name ?? '') === this.channelKey(row.toAccountName)),
      );
      if (exact) {
        used.add(exact.id);
        return {
          ...row,
          status: 'exists' as const,
          existingAmount: Number(exact.amountUyu),
          existingDescription: exact.description ?? null,
          existingMovementId: exact.id,
        };
      }
      const sameChannel = incomePool.find(
        (m) =>
          !used.has(m.id) &&
          m.businessDate === row.businessDate &&
          (m.toAccountId === row.toAccountId ||
            this.channelKey(m.toAccount?.name ?? '') === this.channelKey(row.toAccountName)),
      );
      if (sameChannel) {
        used.add(sameChannel.id);
        return {
          ...row,
          status: 'mismatch' as const,
          existingAmount: Number(sameChannel.amountUyu),
          existingDescription: sameChannel.description ?? null,
          existingMovementId: sameChannel.id,
        };
      }
      return {
        ...row,
        status: 'new' as const,
        existingAmount: 0,
        existingDescription: null,
        existingMovementId: null as string | null,
      };
    });

    const selectedKeys =
      selected == null ? null : new Set(selected.map((s) => this.incomeItemKey(s)));
    const picked = (i: (typeof items)[number]) =>
      !selectedKeys || selectedKeys.has(this.incomeItemKey(i));
    const toCreate = items.filter(
      (i) => i.status === 'new' && i.toAccountId && picked(i),
    );
    const toUpdate = items.filter(
      (i) =>
        i.status === 'mismatch' && i.existingMovementId && selectedKeys && picked(i),
    );
    if (commit && toCreate.length) {
      await this.movements.save(
        toCreate.map((r) =>
          this.movements.create({
            shopId,
            businessDate: r.businessDate,
            fromAccountId: r.fromAccountId,
            toAccountId: r.toAccountId,
            description: r.label,
            amountUyu: money(r.amount),
            conceptId: r.conceptId,
            closingId: r.closingId,
            invoiced: false,
            active: true,
          }),
        ),
      );
    }
    if (commit && toUpdate.length) {
      for (const r of toUpdate) {
        await this.movements.update(
          { id: r.existingMovementId!, shopId },
          {
            amountUyu: money(r.amount),
            description: r.label,
            closingId: r.closingId,
          },
        );
      }
    }

    const extras = [
      ...toCreate,
      ...toUpdate.map((r) => ({
        toAccountId: r.toAccountId,
        amount: r.amount - r.existingAmount,
      })),
    ];
    const balances = this.projectBalances(accounts, liveExisting, extras);
    return {
      closingsCount: closings.length,
      createdCount: commit ? toCreate.length : 0,
      updatedCount: commit ? toUpdate.length : 0,
      items,
      counts: {
        new: items.filter((i) => i.status === 'new').length,
        exists: items.filter((i) => i.status === 'exists').length,
        mismatch: items.filter((i) => i.status === 'mismatch').length,
        skipped: items.filter((i) => i.status === 'skipped').length,
      },
      balances,
    };
  }

  private expectedIncomes(
    closings: CashClosing[],
    accounts: LedgerAccount[],
    ingreso: LedgerAccount,
    cashDest: LedgerAccount | null,
  ) {
    const byMethod = new Map<string, LedgerAccount>();
    for (const a of accounts) {
      if (!a.active || !a.linkedPaymentMethod) continue;
      byMethod.set(a.linkedPaymentMethod, a);
    }
    const rows: Array<{
      closingId: string;
      businessDate: string;
      fromAccountId: string;
      toAccountId: string | null;
      toAccountName: string;
      amount: number;
      label: string;
      conceptId: string | null;
    }> = [];
    const push = (
      closing: CashClosing,
      method: LinkedPaymentMethod | null,
      amount: number,
      label: string,
      dest?: LedgerAccount | null,
    ) => {
      if (!(amount > 0)) return;
      const channel = dest ?? (method ? byMethod.get(method) : undefined) ?? null;
      rows.push({
        closingId: closing.id,
        businessDate: closing.businessDate,
        fromAccountId: ingreso.id,
        toAccountId: channel?.id ?? null,
        toAccountName: channel?.name ?? label,
        amount: Math.round(amount * 100) / 100,
        label,
        conceptId: null,
      });
    };
    for (const closing of closings) {
      const expensesTotal = (closing.expenses ?? []).reduce((s, e) => s + n(e.amount), 0);
      const cashIncome =
        n(closing.cashAmount) - n(closing.cashOpeningAmount) + expensesTotal;
      push(closing, null, cashIncome, 'Efectivo del día', cashDest);
      const sourceRows = closing.sourceAmounts ?? [];
      if (!sourceRows.length) {
        push(closing, LinkedPaymentMethod.CARD, n(closing.cardAmount), 'PVS / Tarjeta');
        push(
          closing,
          LinkedPaymentMethod.MERCADO_PAGO,
          n(closing.mercadoPagoAmount),
          'Mercado Pago',
        );
        push(closing, LinkedPaymentMethod.DELIVERY, n(closing.deliveryAppsAmount), 'Delivery');
        push(closing, LinkedPaymentMethod.TRANSFER, n(closing.transferAmount), 'Transferencia');
        push(closing, LinkedPaymentMethod.ACCOUNT_DNI, n(closing.accountDniAmount), 'Cuenta DNI');
        push(closing, LinkedPaymentMethod.OTHER, n(closing.otherAmount), 'Otros ingresos');
      } else {
        for (const src of sourceRows) {
          const amount = n(src.amount);
          if (!(amount > 0) || src.kind !== ClosingSourceKind.OWN_ACCOUNT || !src.accountId) {
            continue;
          }
          if (String(src.role ?? '') === 'CASH') continue;
          const dest = accounts.find((a) => a.id === src.accountId) ?? null;
          push(closing, null, amount, src.name, dest);
        }
        if (n(closing.otherAmount) > 0) {
          push(closing, LinkedPaymentMethod.OTHER, n(closing.otherAmount), 'Otros ingresos');
        }
      }
    }
    return rows;
  }

  private isIngresoAccount(account?: LedgerAccount | null): boolean {
    if (!account) return false;
    if (account.code === 'INGRESO') return true;
    const name = account.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return name.includes('ingreso');
  }

  private channelKey(name: string): string {
    const nrm = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (nrm.includes('pvs') || nrm.includes('posnet') || nrm.includes('tarjeta')) return 'card';
    if (nrm.includes('mp') || nrm.includes('mercado')) return 'mp';
    if (nrm.includes('efectivo') || nrm.includes('caja')) return 'cash';
    if (nrm.includes('dni')) return 'dni';
    if (nrm.includes('delivery') || nrm.includes('rappi') || nrm.includes('pedidosya')) {
      return 'delivery';
    }
    if (nrm.includes('transfer')) return 'transfer';
    return nrm.replace(/[^a-z0-9]+/g, '');
  }

  private projectBalances(
    accounts: LedgerAccount[],
    existing: Movement[],
    extras: Array<{ toAccountId: string | null; amount: number }>,
  ) {
    const bal = new Map<
      string,
      { accountId: string; name: string; type: string; current: number; incoming: number }
    >();
    for (const a of accounts) {
      if (!a.active) continue;
      if (a.type !== LedgerAccountType.PARTNER && a.type !== LedgerAccountType.CHANNEL) continue;
      bal.set(a.id, {
        accountId: a.id,
        name: a.name,
        type: a.type,
        current: 0,
        incoming: 0,
      });
    }
    for (const m of existing) {
      const amt = Number(m.amountUyu);
      if (m.fromAccountId && bal.has(m.fromAccountId)) {
        const row = bal.get(m.fromAccountId)!;
        row.current -= amt;
      }
      if (m.toAccountId && bal.has(m.toAccountId)) {
        const row = bal.get(m.toAccountId)!;
        row.current += amt;
      }
    }
    for (const extra of extras) {
      if (!extra.toAccountId) continue;
      const row = bal.get(extra.toAccountId);
      if (row) row.incoming += extra.amount;
    }
    const rank = (t: string) => (t === LedgerAccountType.CHANNEL ? 0 : 1);
    return [...bal.values()]
      .map((a) => ({
        accountId: a.accountId,
        name: a.name,
        type: a.type,
        current: Math.round(a.current * 100) / 100,
        incoming: Math.round(a.incoming * 100) / 100,
        projected: Math.round((a.current + a.incoming) * 100) / 100,
      }))
      .sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name, 'es'));
  }
}
