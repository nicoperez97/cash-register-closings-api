import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
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
import {
  findCashShortcutOrphan,
  movementChannelKey,
  movementExactKey,
  sameMovementEconomics,
  sameWithdrawalEconomics,
} from './closing-movements-diff.util';
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
    const rows = await this.planFromClosing(closing);
    // Huérfanos del mismo día (import Excel / libro sin closingId) que ya cubren el
    // plan: si no los sacamos, delete+recreate duplica ingresos/retiros y rompe saldos
    // (incl. socios ya drenados por dividendos).
    await this.absorbOrphanPlanMatches(
      closing.shopId,
      rows,
      closing.businessDate,
      n(closing.cashAmount),
    );
    await this.movements.delete({ closingId: closing.id });
    if (rows.length) {
      await this.movements.save(rows.map((r) => this.movements.create(r)));
    }
  }

  /**
   * Baja movimientos sin closingId que ya son el mismo asiento que el plan del cierre
   * (fecha del asiento o del cierre + economía / retiro a mismo socio).
   */
  private async absorbOrphanPlanMatches(
    shopId: string,
    planned: Partial<Movement>[],
    closingBusinessDate?: string,
    legacyCashAmount?: number,
  ): Promise<void> {
    if (!planned.length) return;
    const orphans = await this.movements.find({
      where: { shopId, active: true, closingId: IsNull() },
      relations: ['fromAccount'],
    });
    if (!orphans.length) return;
    const unused = new Set(orphans.map((m) => m.id));
    const removeIds: string[] = [];
    const closingDay = String(closingBusinessDate ?? '').slice(0, 10);
    const inDates = (m: Movement, dates: Set<string>) =>
      dates.has(String(m.businessDate ?? '').slice(0, 10));

    const cashIncome = planned.find(
      (p) => movementChannelKey(String(p.description ?? '')) === 'cash_income',
    );
    const withdrawal = planned.find(
      (p) => movementChannelKey(String(p.description ?? '')) === 'cash_withdrawal',
    );
    let cashShortcutId: string | null = null;
    if (cashIncome && withdrawal?.toAccountId) {
      const dates = new Set(
        [String(cashIncome.businessDate ?? '').slice(0, 10), closingDay].filter(Boolean),
      );
      const pool = orphans.filter((m) => unused.has(m.id) && inDates(m, dates));
      const shortcut = findCashShortcutOrphan(
        pool,
        unused,
        withdrawal.toAccountId,
        [n(cashIncome.amountUyu), n(withdrawal.amountUyu), Number(legacyCashAmount ?? 0)],
        (m) => this.isIngresoAccount(m.fromAccount),
      );
      if (shortcut) {
        unused.delete(shortcut.id);
        removeIds.push(shortcut.id);
        cashShortcutId = shortcut.id;
      }
    }

    for (const p of planned) {
      const pKey = movementChannelKey(String(p.description ?? ''));
      if (
        cashShortcutId &&
        (pKey === 'cash_income' || pKey === 'cash_withdrawal')
      ) {
        continue;
      }
      const dates = new Set(
        [String(p.businessDate ?? '').slice(0, 10), closingDay].filter(Boolean),
      );
      const pool = orphans.filter((m) => unused.has(m.id) && inDates(m, dates));
      const hit =
        pool.find((m) => movementExactKey(m) === movementExactKey(p)) ??
        pool.find((m) => sameMovementEconomics(m, p)) ??
        pool.find((m) => sameWithdrawalEconomics(m, p)) ??
        pool.find(
          (m) =>
            movementChannelKey(String(m.description ?? '')) === pKey &&
            (m.fromAccountId ?? null) === (p.fromAccountId ?? null) &&
            (m.toAccountId ?? null) === (p.toAccountId ?? null),
        );
      if (!hit) continue;
      unused.delete(hit.id);
      removeIds.push(hit.id);
    }
    if (!removeIds.length) return;
    await this.movements.update({ id: In(removeIds) }, { active: false });
    await this.movements.softDelete({ id: In(removeIds) });
  }

  /** Arma los asientos del cierre según la config actual, sin persistir. */
  async planFromClosing(closing: CashClosing): Promise<Partial<Movement>[]> {
    await this.catalogSeed.ensureShopCatalogs(closing.shopId);

    const accounts = await this.accounts.find({ where: { shopId: closing.shopId } });
    if (!accounts.length) return [];
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    const ingreso = byCode.get('INGRESO');
    const egreso = byCode.get('EGRESO');
    if (!ingreso || !egreso) return [];

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
    const closingIncomeConceptId = this.resolveClosingIncomeConceptId(
      shop,
      concepts,
      findConcept,
    );
    const closingCashConceptId = this.resolveClosingCashConceptId(
      shop,
      concepts,
      findConcept,
    );

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
        conceptId: closingCashConceptId,
        closingId: closing.id,
        invoiced: false,
        active: true,
      });
    }

    // Cuentas del local (OWN_ACCOUNT): un asiento por source con monto > 0.
    // Compat legacy: si aún hay montos en columnas canal y no hay sourceAmounts, usar linkedPaymentMethod.
    const sourceRows = closing.sourceAmounts ?? [];
    const resolveSourceDest = (src: {
      name?: string | null;
      accountId?: string | null;
      kind?: string | null;
    }): LedgerAccount | null => {
      if (src.kind && src.kind !== ClosingSourceKind.OWN_ACCOUNT) return null;
      if (src.accountId) {
        const byId = accounts.find((a) => a.id === src.accountId);
        if (byId) return byId;
      }
      const norm = (s?: string | null) =>
        String(s ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();
      const name = norm(src.name);
      if (!name) return null;
      // Si la cuenta del local quedó sin accountId, primero buscamos una cuenta con
      // el MISMO nombre (p. ej. «Pedidos Ya» → cuenta «Pedidos Ya»). Así no se
      // mezclan todas las apps de delivery en una única cuenta genérica «Delivery».
      const byOwnName = accounts.find((a) => a.active && norm(a.name) === name);
      if (byOwnName) return byOwnName;
      const byCode = (codes: string[], linked?: LinkedPaymentMethod) =>
        accounts.find(
          (a) =>
            a.active &&
            (codes.includes(a.code) ||
              (linked != null && a.linkedPaymentMethod === linked)),
        ) ?? null;
      if (name === 'pvs' || name.includes('pvs') || name.includes('tarjeta') || name === 'card') {
        return byCode(['PVS'], LinkedPaymentMethod.CARD);
      }
      if (name.includes('mercado') || name === 'mp' || name === 'mercadopago') {
        return byCode(['MP'], LinkedPaymentMethod.MERCADO_PAGO);
      }
      if (name.includes('dni')) {
        return byCode(['DNI'], LinkedPaymentMethod.ACCOUNT_DNI);
      }
      if (name.includes('transfer')) {
        return byCode(['TRANSFER'], LinkedPaymentMethod.TRANSFER);
      }
      // Sin coincidencia por cuenta propia ni canal canónico: no inventamos destino
      // (antes caía en la cuenta genérica «Delivery», mezclando Pedidos Ya/Rappi/etc.).
      return null;
    };
    for (const src of sourceRows) {
      const amount = n(src.amount);
      if (amount <= 0) continue;
      if (String(src.role ?? '') === 'CASH') continue;
      const dest = resolveSourceDest(src);
      if (!dest) continue;
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: ingresoAccount.id,
        toAccountId: dest.id,
        description: src.name,
        amountUyu: money(amount),
        conceptId: closingIncomeConceptId,
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
          conceptId: conceptName === 'Cobro' ? closingIncomeConceptId : findConcept(conceptName),
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

    // Misma cuenta que el depósito del cierre: si usamos otra (código EFECTIVO ≠
    // fuente CASH), el preview acredita socios sin debitar "Efectivo Caja".
    const cashChannel = cashDest;
    const cashDrawer = cashChannel ?? findCashDrawerAccount(accounts);

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

    // Cambio aportado a la caja: cuenta de quien lo dejó → Efectivo Caja
    // (mismo concepto configurado para “quién se lo lleva”).
    const changeConceptId = this.resolveWithdrawalConceptId(shop, concepts, findConcept);
    if (cashDrawer) {
      for (const row of closing.cashChangeContributions ?? []) {
        const amount = n(row.amount);
        const fromId = String(row.accountId ?? '').trim();
        if (amount <= 0 || !fromId) continue;
        const from = accounts.find((a) => a.id === fromId);
        if (!from) continue;
        rows.push({
          shopId: closing.shopId,
          businessDate: date,
          fromAccountId: from.id,
          toAccountId: cashDrawer.id,
          description: `Cambio en caja — ${row.name?.trim() || from.name}`,
          amountUyu: money(amount),
          conceptId: changeConceptId,
          closingId: closing.id,
          invoiced: false,
          active: true,
        });
      }
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

    return rows;
  }

  async previewResyncMovements(shopId: string) {
    await this.catalogSeed.ensureShopCatalogs(shopId);
    const accounts = await this.accounts.find({ where: { shopId } });
    const accountName = (id?: string | null) =>
      (id ? accounts.find((a) => a.id === id)?.name : null) ?? null;

    const closings = await this.closings.find({
      where: { shopId },
      relations: ['expenses', 'extraLines', 'sourceAmounts'],
      order: { businessDate: 'ASC' },
    });

    // Hay que traer `closing`: sin eso isLiveClosingMovement trata como muertos
    // los movimientos con closingId (closing queda null) y el preview cree que
    // todo es "agregado". Los saldos "Hoy" deben incluir todos los movimientos
    // vivos (cierres + gastos/ingresos/pases), no solo los del cierre.
    const existingAll = await this.movements.find({
      where: { shopId, active: true },
      relations: ['fromAccount', 'toAccount', 'closing'],
    });
    const liveExisting = existingAll.filter((m) => isLiveClosingMovement(m));
    const byClosing = new Map<string, Movement[]>();
    // Movimientos del libro sin cierre (Excel, dividendos, pases): ya cuentan en "Hoy".
    const orphansByDate = new Map<string, Movement[]>();
    const unusedOrphans = new Set<string>();
    for (const m of liveExisting) {
      if (m.closingId) {
        const list = byClosing.get(m.closingId) ?? [];
        list.push(m);
        byClosing.set(m.closingId, list);
        continue;
      }
      // No usar dividendos como suplentes de asientos del cierre (otro from/to).
      if (movementChannelKey(String(m.description ?? '')) === 'dividend') continue;
      const day = String(m.businessDate ?? '').slice(0, 10);
      if (!day) continue;
      const list = orphansByDate.get(day) ?? [];
      list.push(m);
      orphansByDate.set(day, list);
      unusedOrphans.add(m.id);
    }

    type DiffStatus = 'unchanged' | 'added' | 'removed' | 'changed';
    type DiffItem = {
      closingId: string;
      businessDate: string;
      status: DiffStatus;
      label: string;
      currentFromAccountId: string | null;
      currentFromAccountName: string | null;
      currentToAccountId: string | null;
      currentToAccountName: string | null;
      currentAmount: number;
      plannedFromAccountId: string | null;
      plannedFromAccountName: string | null;
      plannedToAccountId: string | null;
      plannedToAccountName: string | null;
      plannedAmount: number;
    };

    const items: DiffItem[] = [];
    const changedClosingIds = new Set<string>();
    const balanceDeltas = new Map<string, number>();

    const bump = (accountId: string | null | undefined, delta: number) => {
      if (!accountId || Math.abs(delta) < 0.005) return;
      balanceDeltas.set(accountId, (balanceDeltas.get(accountId) ?? 0) + delta);
    };

    const claim = (unused: Set<string>, m: Movement) => {
      unused.delete(m.id);
      unusedOrphans.delete(m.id);
    };

    for (const closing of closings) {
      const planned = await this.planFromClosing(closing);
      const current = byClosing.get(closing.id) ?? [];
      const unused = new Set(current.map((m) => m.id));

      const pushUnchanged = (
        m: Movement,
        plannedRow: Partial<Movement>,
        opts?: { claim?: boolean },
      ) => {
        if (opts?.claim !== false) claim(unused, m);
        items.push({
          closingId: closing.id,
          businessDate: closing.businessDate,
          status: 'unchanged',
          label: String(plannedRow.description ?? m.description ?? ''),
          currentFromAccountId: m.fromAccountId ?? null,
          currentFromAccountName: m.fromAccount?.name ?? accountName(m.fromAccountId),
          currentToAccountId: m.toAccountId ?? null,
          currentToAccountName: m.toAccount?.name ?? accountName(m.toAccountId),
          currentAmount: n(m.amountUyu),
          plannedFromAccountId: plannedRow.fromAccountId ?? null,
          plannedFromAccountName: accountName(plannedRow.fromAccountId),
          plannedToAccountId: plannedRow.toAccountId ?? null,
          plannedToAccountName: accountName(plannedRow.toAccountId),
          plannedAmount: n(plannedRow.amountUyu),
        });
      };

      const pushChanged = (m: Movement, plannedRow: Partial<Movement>) => {
        claim(unused, m);
        changedClosingIds.add(closing.id);
        items.push({
          closingId: closing.id,
          businessDate: closing.businessDate,
          status: 'changed',
          label: String(plannedRow.description ?? m.description ?? ''),
          currentFromAccountId: m.fromAccountId ?? null,
          currentFromAccountName: m.fromAccount?.name ?? accountName(m.fromAccountId),
          currentToAccountId: m.toAccountId ?? null,
          currentToAccountName: m.toAccount?.name ?? accountName(m.toAccountId),
          currentAmount: n(m.amountUyu),
          plannedFromAccountId: plannedRow.fromAccountId ?? null,
          plannedFromAccountName: accountName(plannedRow.fromAccountId),
          plannedToAccountId: plannedRow.toAccountId ?? null,
          plannedToAccountName: accountName(plannedRow.toAccountId),
          plannedAmount: n(plannedRow.amountUyu),
        });
        // Quitar efecto actual, sumar efecto planificado.
        bump(m.fromAccountId, n(m.amountUyu));
        bump(m.toAccountId, -n(m.amountUyu));
        bump(plannedRow.fromAccountId, -n(plannedRow.amountUyu));
        bump(plannedRow.toAccountId, n(plannedRow.amountUyu));
      };

      const findIn = (
        pool: Movement[],
        unusedSet: Set<string>,
        plannedRow: Partial<Movement>,
        mode: 'exact' | 'relabel' | 'withdrawal' | 'sameLane' | 'soft',
      ): Movement | undefined => {
        const plannedKey = this.channelKey(String(plannedRow.description ?? ''));
        return pool.find((m) => {
          if (!unusedSet.has(m.id)) return false;
          if (mode === 'exact') return movementExactKey(m) === movementExactKey(plannedRow);
          if (mode === 'relabel') return sameMovementEconomics(m, plannedRow);
          if (mode === 'withdrawal') return sameWithdrawalEconomics(m, plannedRow);
          if (mode === 'sameLane') {
            return (
              this.channelKey(String(m.description ?? '')) === plannedKey &&
              (m.fromAccountId ?? null) === (plannedRow.fromAccountId ?? null) &&
              (m.toAccountId ?? null) === (plannedRow.toAccountId ?? null)
            );
          }
          return this.channelKey(String(m.description ?? '')) === plannedKey;
        });
      };

      const orphanPoolFor = (plannedRow: Partial<Movement>): Movement[] => {
        // Retiros pueden fecharse el día del pick; el Excel suele estar en el día del cierre.
        const days = new Set(
          [
            String(plannedRow.businessDate ?? closing.businessDate).slice(0, 10),
            String(closing.businessDate).slice(0, 10),
          ].filter(Boolean),
        );
        const out: Movement[] = [];
        const seen = new Set<string>();
        for (const day of days) {
          for (const m of orphansByDate.get(day) ?? []) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            out.push(m);
          }
        }
        return out;
      };

      // Excel histórico: "Ventas en efectivo" / "efectivo" = Ingreso → Socio
      // (sin pasar por Efectivo Caja). Eso cubre efectivo del día + retiro.
      const plannedCashIncome = planned.find(
        (row) => movementChannelKey(String(row.description ?? '')) === 'cash_income',
      );
      const plannedWithdrawal = planned.find(
        (row) => movementChannelKey(String(row.description ?? '')) === 'cash_withdrawal',
      );
      const shortcutPartnerId = plannedWithdrawal?.toAccountId ?? null;
      const shortcutAmounts = [
        plannedCashIncome ? n(plannedCashIncome.amountUyu) : 0,
        plannedWithdrawal ? n(plannedWithdrawal.amountUyu) : 0,
        n(closing.cashAmount),
      ];
      const shortcutPool = orphanPoolFor(plannedCashIncome ?? plannedWithdrawal ?? {});
      const cashShortcut = findCashShortcutOrphan(
        shortcutPool,
        unusedOrphans,
        shortcutPartnerId,
        shortcutAmounts,
        (m) => this.isIngresoAccount(m.fromAccount),
      );

      for (const p of planned) {
        const orphanPool = orphanPoolFor(p);
        const pKey = movementChannelKey(String(p.description ?? ''));

        // Atajo Excel Ingreso→Socio: cuenta como efectivo del día y como retiro.
        if (
          cashShortcut &&
          (pKey === 'cash_income' || pKey === 'cash_withdrawal') &&
          (pKey !== 'cash_withdrawal' || (p.toAccountId ?? null) === shortcutPartnerId)
        ) {
          const alreadyClaimed = !unusedOrphans.has(cashShortcut.id) && !unused.has(cashShortcut.id);
          pushUnchanged(cashShortcut, p, { claim: !alreadyClaimed });
          continue;
        }

        // 1–2) Ligados al cierre, luego huérfanos (Excel / libro viejo).
        const exact =
          findIn(current, unused, p, 'exact') ?? findIn(orphanPool, unusedOrphans, p, 'exact');
        if (exact) {
          pushUnchanged(exact, p);
          continue;
        }

        const relabel =
          findIn(current, unused, p, 'relabel') ??
          findIn(orphanPool, unusedOrphans, p, 'relabel');
        if (relabel) {
          pushUnchanged(relabel, p);
          continue;
        }

        // Mismo retiro a socio (monto + destino). Si solo cambia la caja origen, es Distinto.
        const withdrawal =
          findIn(current, unused, p, 'withdrawal') ??
          findIn(orphanPool, unusedOrphans, p, 'withdrawal');
        if (withdrawal) {
          if ((withdrawal.fromAccountId ?? null) === (p.fromAccountId ?? null)) {
            pushUnchanged(withdrawal, p);
          } else {
            pushChanged(withdrawal, p);
          }
          continue;
        }

        // 3) Mismo carril + mismas cuentas, otro monto (cierre o huérfano).
        // Efectivo del día legacy: el libro tiene el contado (sin restar apertura).
        // Tiene que ir ANTES de sameLane; si no, lo marca Distinto (170k vs 148k).
        if (pKey === 'cash_income') {
          const legacyAmt = n(closing.cashAmount);
          const legacy = current.find(
            (m) =>
              unused.has(m.id) &&
              movementChannelKey(String(m.description ?? '')) === 'cash_income' &&
              (m.fromAccountId ?? null) === (p.fromAccountId ?? null) &&
              (m.toAccountId ?? null) === (p.toAccountId ?? null) &&
              Math.abs(n(m.amountUyu) - legacyAmt) < 0.005,
          );
          if (legacy) {
            pushUnchanged(legacy, p);
            continue;
          }
        }

        const sameLane =
          findIn(current, unused, p, 'sameLane') ??
          findIn(orphanPool, unusedOrphans, p, 'sameLane');
        if (sameLane) {
          pushChanged(sameLane, p);
          continue;
        }

        // 4) Soft solo entre movimientos ya ligados al cierre (no robar huérfanos ajenos).
        const soft = findIn(current, unused, p, 'soft');
        if (soft) {
          pushChanged(soft, p);
          continue;
        }

        changedClosingIds.add(closing.id);
        items.push({
          closingId: closing.id,
          businessDate: closing.businessDate,
          status: 'added',
          label: String(p.description ?? ''),
          currentFromAccountId: null,
          currentFromAccountName: null,
          currentToAccountId: null,
          currentToAccountName: null,
          currentAmount: 0,
          plannedFromAccountId: p.fromAccountId ?? null,
          plannedFromAccountName: accountName(p.fromAccountId),
          plannedToAccountId: p.toAccountId ?? null,
          plannedToAccountName: accountName(p.toAccountId),
          plannedAmount: n(p.amountUyu),
        });
        bump(p.fromAccountId, -n(p.amountUyu));
        bump(p.toAccountId, n(p.amountUyu));
      }

      for (const m of current) {
        if (!unused.has(m.id)) continue;
        // Dividendos ligados por error al cierre: no son del plan; no proponer quitarlos.
        if (movementChannelKey(String(m.description ?? '')) === 'dividend') continue;
        if (m.beneficiaryAccountId) continue;
        changedClosingIds.add(closing.id);
        items.push({
          closingId: closing.id,
          businessDate: closing.businessDate,
          status: 'removed',
          label: String(m.description ?? ''),
          currentFromAccountId: m.fromAccountId ?? null,
          currentFromAccountName: m.fromAccount?.name ?? accountName(m.fromAccountId),
          currentToAccountId: m.toAccountId ?? null,
          currentToAccountName: m.toAccount?.name ?? accountName(m.toAccountId),
          currentAmount: n(m.amountUyu),
          plannedFromAccountId: null,
          plannedFromAccountName: null,
          plannedToAccountId: null,
          plannedToAccountName: null,
          plannedAmount: 0,
        });
        bump(m.fromAccountId, n(m.amountUyu));
        bump(m.toAccountId, -n(m.amountUyu));
      }
    }

    const extras = [...balanceDeltas.entries()].map(([toAccountId, amount]) => ({
      toAccountId,
      amount,
    }));
    // projectBalances suma incoming en toAccount; acá el delta ya viene con signo
    // por cuenta (from=negativo en bump invertido). Reusamos el helper pasando
    // el delta directo como "incoming" por accountId.
    const balances = this.projectBalances(accounts, liveExisting, extras).filter(
      (b) => Math.abs(b.incoming) >= 0.005,
    );

    return {
      closingsCount: closings.length,
      changedClosingsCount: changedClosingIds.size,
      items,
      counts: {
        unchanged: items.filter((i) => i.status === 'unchanged').length,
        added: items.filter((i) => i.status === 'added').length,
        removed: items.filter((i) => i.status === 'removed').length,
        changed: items.filter((i) => i.status === 'changed').length,
      },
      balances,
    };
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

  private resolveClosingIncomeConceptId(
    shop: Shop | null,
    concepts: Concept[],
    findConcept: (name: string) => string | null,
  ): string | null {
    const configuredId = shop?.closingIncomeConceptId?.trim();
    if (configuredId) {
      const configured = concepts.find((c) => c.id === configuredId && c.active);
      if (configured) return configured.id;
    }
    return findConcept('Cobro') ?? findConcept('Ingreso');
  }

  private resolveClosingCashConceptId(
    shop: Shop | null,
    concepts: Concept[],
    findConcept: (name: string) => string | null,
  ): string | null {
    const configuredId = shop?.closingCashConceptId?.trim();
    if (configuredId) {
      const configured = concepts.find((c) => c.id === configuredId && c.active);
      if (configured) return configured.id;
    }
    return findConcept('EFECTIVO ingreso') ?? findConcept('Ingreso') ?? findConcept('Cobro');
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
          if (!(amount > 0)) continue;
          if (String(src.role ?? '') === 'CASH') continue;
          if (src.kind && src.kind !== ClosingSourceKind.OWN_ACCOUNT) continue;
          let dest = src.accountId
            ? accounts.find((a) => a.id === src.accountId) ?? null
            : null;
          if (!dest) {
            const name = String(src.name ?? '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .trim();
            const byCode = (codes: string[], linked?: LinkedPaymentMethod) =>
              accounts.find(
                (a) =>
                  a.active &&
                  (codes.includes(a.code) ||
                    (linked != null && a.linkedPaymentMethod === linked)),
              ) ?? null;
            if (
              name === 'pvs' ||
              name.includes('pvs') ||
              name.includes('tarjeta') ||
              name === 'card'
            ) {
              dest = byCode(['PVS'], LinkedPaymentMethod.CARD);
            } else if (name.includes('mercado') || name === 'mp' || name === 'mercadopago') {
              dest = byCode(['MP'], LinkedPaymentMethod.MERCADO_PAGO);
            } else if (name.includes('dni')) {
              dest = byCode(['DNI'], LinkedPaymentMethod.ACCOUNT_DNI);
            }
          }
          if (!dest) continue;
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
    return movementChannelKey(name);
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
      const isPartnerOrChannel =
        a.type === LedgerAccountType.PARTNER || a.type === LedgerAccountType.CHANNEL;
      // Misma regla que Saldos: Dividendos solo si listInBalances (legacy).
      const isListedDividend =
        a.type === LedgerAccountType.DIVIDENDS && Number(a.listInBalances ?? 1) !== 0;
      if (!isPartnerOrChannel && !isListedDividend) continue;
      bal.set(a.id, {
        accountId: a.id,
        name: a.name,
        type: a.type,
        current: Number(a.openingBalance ?? 0),
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
    const rank = (t: string) => {
      if (t === LedgerAccountType.CHANNEL) return 0;
      if (t === LedgerAccountType.PARTNER) return 1;
      if (t === LedgerAccountType.DIVIDENDS) return 2;
      return 9;
    };
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
