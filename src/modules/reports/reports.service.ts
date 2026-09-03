import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { ShopsService } from '../shops/shops.service';
import { MovementsService } from '../movements/movements.service';
import { PayrollService } from '../payroll/payroll.service';
import { SalesProductsAnalyticsService } from '../sales-reports/sales-products-analytics.service';
import { ReservationsService } from '../reservations/reservations.service';
import { TipsService } from '../tips/tips.service';
import { AuthUser } from '../../common/decorators';
import { closingStatusLabel } from '../../common/labels.es';
import {
  applyClosingFilters,
  ClosingListFilters,
} from '../closings/closing-filters';

const n = (v?: string | number | null) => Number(v ?? 0);

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function previousPeriod(from: string, to: string): { from: string; to: string } {
  const fromD = new Date(`${from}T12:00:00.000Z`);
  const toD = new Date(`${to}T12:00:00.000Z`);
  const days =
    Math.round((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const prevTo = new Date(fromD);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  return { from: isoDate(prevFrom), to: isoDate(prevTo) };
}

function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    @InjectRepository(AttendanceDay)
    private readonly attendance: Repository<AttendanceDay>,
    private readonly shops: ShopsService,
    private readonly movementsService: MovementsService,
    private readonly payroll: PayrollService,
    private readonly salesProducts: SalesProductsAnalyticsService,
    private readonly reservations: ReservationsService,
    private readonly tips: TipsService,
  ) {}

  private async filteredRows(shopId: string, filters: ClosingListFilters) {
    const qb = this.closings
      .createQueryBuilder('c')
      .where('c.shopId = :shopId', { shopId })
      .andWhere('c.active = true');
    applyClosingFilters(qb, 'c', filters);
    qb.orderBy('c.businessDate', 'ASC');
    return qb.getMany();
  }

  private closingRowTotals(rows: CashClosing[]) {
    return rows.reduce(
      (acc, r) => {
        acc.card += n(r.cardAmount);
        acc.cash += n(r.cashAmount);
        acc.mp += n(r.mercadoPagoAmount);
        acc.delivery += n(r.deliveryAppsAmount);
        acc.transfer += n(r.transferAmount);
        acc.dni += n(r.accountDniAmount);
        acc.other += n(r.otherAmount);
        acc.declared += n(r.declaredTotal);
        acc.withdrawn += n(r.cashWithdrawn);
        acc.units += r.unitsSold ?? 0;
        acc.covers += r.coversCount ?? 0;
        acc.difference += Math.abs(n(r.difference));
        return acc;
      },
      {
        card: 0,
        cash: 0,
        mp: 0,
        delivery: 0,
        transfer: 0,
        dni: 0,
        other: 0,
        declared: 0,
        withdrawn: 0,
        units: 0,
        covers: 0,
        difference: 0,
      },
    );
  }

  /**
   * Dashboard mixto: cierres + ventas POS + reservas + propinas.
   * Solo lectura; el import POS no escribe aquí ni en cierres/saldos.
   */
  async dashboard(user: AuthUser, shopId: string, filters: ClosingListFilters) {
    this.shops.assertShopAccess(user, shopId);
    const from = filters.from;
    const to = filters.to;
    if (!from || !to) {
      return {
        shopId,
        from: from ?? null,
        to: to ?? null,
        closings: null,
        pos: null,
        reservations: null,
        tips: null,
        comparison: null,
        paymentMix: null,
        weekday: null,
      };
    }

    const prev = previousPeriod(from, to);
    const [rows, pos, reservations, tips, prevRows, prevPos, prevTips] =
      await Promise.all([
        this.filteredRows(shopId, { from, to }),
        this.salesProducts.summary(user, shopId, { from, to }),
        this.safeReservationsSummary(user, shopId, from, to),
        this.tips.summary(user, shopId, from, to),
        this.filteredRows(shopId, { from: prev.from, to: prev.to }),
        this.salesProducts.summary(user, shopId, { from: prev.from, to: prev.to }),
        this.tips.summary(user, shopId, prev.from, prev.to),
      ]);

    const closingsTotals = this.closingRowTotals(rows);
    const prevClosingsTotals = this.closingRowTotals(prevRows);
    const diffDays = rows.filter((r) => Math.abs(n(r.difference)) > 0.02);
    const covers = closingsTotals.covers;
    const avgTicketBox =
      covers > 0 ? Math.round((closingsTotals.declared / covers) * 100) / 100 : null;

    const paymentMix = {
      cash: closingsTotals.cash,
      card: closingsTotals.card,
      mercadoPago: closingsTotals.mp,
      transfer: closingsTotals.transfer,
      accountDni: closingsTotals.dni,
      deliveryApps: closingsTotals.delivery,
      other: closingsTotals.other,
    };

    const weekdayMap = new Map<number, { amount: number; count: number }>();
    for (const d of pos.byDay) {
      const dt = new Date(`${d.date}T12:00:00.000Z`);
      const wd = dt.getUTCDay();
      const cur = weekdayMap.get(wd) ?? { amount: 0, count: 0 };
      cur.amount += n(d.amount);
      cur.count += 1;
      weekdayMap.set(wd, cur);
    }
    const weekdayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const weekday = weekdayLabels.map((label, day) => {
      const cur = weekdayMap.get(day) ?? { amount: 0, count: 0 };
      return {
        day,
        label,
        amount: Math.round(cur.amount * 100) / 100,
        avgAmount:
          cur.count > 0 ? Math.round((cur.amount / cur.count) * 100) / 100 : 0,
        count: cur.count,
      };
    });

    return {
      shopId,
      from,
      to,
      closings: {
        count: rows.length,
        totals: {
          declared: closingsTotals.declared,
          cash: closingsTotals.cash,
          withdrawn: closingsTotals.withdrawn,
          covers: closingsTotals.covers,
          units: closingsTotals.units,
          difference: closingsTotals.difference,
          avgTicket: avgTicketBox,
          differenceDayCount: diffDays.length,
          differenceAbsSum: Math.round(
            diffDays.reduce((s, r) => s + Math.abs(n(r.difference)), 0) * 100,
          ) / 100,
        },
        byDay: rows.map((d) => ({
          businessDate: d.businessDate,
          declaredTotal: n(d.declaredTotal),
          cashAmount: n(d.cashAmount),
          cashWithdrawn: n(d.cashWithdrawn),
          status: d.status,
          tipsAmount:
            tips.byDay.find((t) => t.businessDate === d.businessDate)?.totalAmount ??
            0,
        })),
      },
      pos: {
        totals: {
          amount: pos.totals.amount,
          qty: pos.totals.qty,
          ticketCount: pos.totals.ticketCount,
          productCount: pos.totals.productCount,
          avgTicketAmount: pos.totals.avgTicketAmount,
        },
        byDay: pos.byDay.map((d) => ({
          businessDate: d.date,
          amount: d.amount,
          qty: d.qty,
          ticketCount: d.ticketCount,
        })),
      },
      reservations,
      tips: {
        enabled: tips.enabled,
        totals: {
          ...tips.totals,
          tipsToBoxRatio:
            closingsTotals.declared > 0
              ? Math.round((tips.totals.total / closingsTotals.declared) * 1000) / 10
              : null,
          tipsToPosRatio:
            pos.totals.amount > 0
              ? Math.round((tips.totals.total / pos.totals.amount) * 1000) / 10
              : null,
        },
        byDay: tips.byDay,
        byEmployee: tips.byEmployee,
      },
      paymentMix,
      weekday,
      comparison: {
        previousFrom: prev.from,
        previousTo: prev.to,
        posAmountDeltaPct: pctDelta(pos.totals.amount, prevPos.totals.amount),
        boxDeclaredDeltaPct: pctDelta(
          closingsTotals.declared,
          prevClosingsTotals.declared,
        ),
        coversDeltaPct: pctDelta(closingsTotals.covers, prevClosingsTotals.covers),
        tipsDeltaPct: pctDelta(tips.totals.total, prevTips.totals.total),
        previous: {
          posAmount: prevPos.totals.amount,
          boxDeclared: prevClosingsTotals.declared,
          covers: prevClosingsTotals.covers,
          tipsTotal: prevTips.totals.total,
        },
      },
    };
  }

  private async safeReservationsSummary(
    user: AuthUser,
    shopId: string,
    from: string,
    to: string,
  ) {
    try {
      const summary = await this.reservations.reservationsSummary(
        user,
        shopId,
        from,
        to,
      );
      const totals = summary.days.reduce(
        (acc, d) => {
          acc.parties += d.parties;
          acc.guests += d.guests;
          acc.inside += d.inside;
          acc.outside += d.outside;
          return acc;
        },
        { parties: 0, guests: 0, inside: 0, outside: 0 },
      );
      return {
        enabled: true,
        from: summary.from,
        to: summary.to,
        totals,
        byDay: summary.days,
      };
    } catch (err) {
      if (err instanceof ForbiddenException) {
        return {
          enabled: false,
          from,
          to,
          totals: { parties: 0, guests: 0, inside: 0, outside: 0 },
          byDay: [] as Array<{
            businessDate: string;
            parties: number;
            guests: number;
            inside: number;
            outside: number;
          }>,
        };
      }
      throw err;
    }
  }

  async summary(user: AuthUser, shopId: string, filters: ClosingListFilters) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.filteredRows(shopId, filters);
    const expensesByConcept = await this.movementsService.expensesByConcept(
      user,
      shopId,
      { from: filters.from, to: filters.to },
    );
    const balances = await this.movementsService.balances(user, shopId, {
      from: filters.from,
      to: filters.to,
    });

    const totals = this.closingRowTotals(rows);

    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      count: rows.length,
      totals,
      expensesTotal: expensesByConcept.total,
      expensesByConcept: expensesByConcept.items.slice(0, 15),
      accountBalances: balances.accounts,
      days: rows.map((r) => ({
        id: r.id,
        businessDate: r.businessDate,
        posSystemAmount: n(r.posSystemAmount),
        calculatedTotal: n(r.calculatedTotal),
        declaredTotal: n(r.declaredTotal),
        cardAmount: n(r.cardAmount),
        cashAmount: n(r.cashAmount),
        mercadoPagoAmount: n(r.mercadoPagoAmount),
        accountDniAmount: n(r.accountDniAmount),
        transferAmount: n(r.transferAmount),
        deliveryAppsAmount: n(r.deliveryAppsAmount),
        otherAmount: n(r.otherAmount),
        cashWithdrawn: n(r.cashWithdrawn),
        cashWithdrawnByName: r.cashWithdrawnByName,
        difference: n(r.difference),
        status: r.status,
        statusCode: r.status,
        statusLabel: closingStatusLabel(r.status),
      })),
    };
  }

  async expensesByConcept(user: AuthUser, shopId: string, filters: ClosingListFilters) {
    return this.movementsService.expensesByConcept(user, shopId, {
      from: filters.from,
      to: filters.to,
    });
  }

  async conceptsAnalytics(
    user: AuthUser,
    shopId: string,
    filters: {
      from?: string;
      to?: string;
      kind?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
      conceptId?: string;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.movementsService.listAnalytics(user, shopId, {
      from: filters.from,
      to: filters.to,
    });
    const tagged = rows.map((r) => {
      const kind = this.inferMovementKind(r);
      return {
        ...r,
        kind,
        conceptName: r.conceptName?.trim() || 'Sin concepto',
      };
    });

    const optionMap = new Map<string, { id: string | null; name: string; kind: string }>();
    for (const r of tagged) {
      const id = r.conceptId ?? `__name:${r.conceptName}`;
      if (optionMap.has(id)) continue;
      optionMap.set(id, { id: r.conceptId, name: r.conceptName, kind: r.kind });
    }
    const conceptOptions = [...optionMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'es'),
    );

    let filtered = tagged;
    if (filters.kind) filtered = filtered.filter((r) => r.kind === filters.kind);
    if (filters.conceptId === '__none') {
      filtered = filtered.filter((r) => !r.conceptId);
    } else if (filters.conceptId) {
      filtered = filtered.filter((r) => r.conceptId === filters.conceptId);
    }

    const current = this.aggregateConceptRows(filtered);
    let comparison: {
      incomeDeltaPct: number | null;
      expenseDeltaPct: number | null;
      countDeltaPct: number | null;
    } | null = null;
    if (filters.from && filters.to) {
      const prevRange = previousPeriod(filters.from, filters.to);
      const prevRows = await this.movementsService.listAnalytics(user, shopId, prevRange);
      let prevTagged = prevRows.map((r) => ({
        ...r,
        kind: this.inferMovementKind(r),
        conceptName: r.conceptName?.trim() || 'Sin concepto',
      }));
      if (filters.kind) prevTagged = prevTagged.filter((r) => r.kind === filters.kind);
      if (filters.conceptId === '__none') {
        prevTagged = prevTagged.filter((r) => !r.conceptId);
      } else if (filters.conceptId) {
        prevTagged = prevTagged.filter((r) => r.conceptId === filters.conceptId);
      }
      const prev = this.aggregateConceptRows(prevTagged);
      comparison = {
        incomeDeltaPct: pctDelta(current.totals.income, prev.totals.income),
        expenseDeltaPct: pctDelta(current.totals.expense, prev.totals.expense),
        countDeltaPct: pctDelta(current.totals.movementCount, prev.totals.movementCount),
      };
    }

    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      conceptOptions,
      comparison,
      ...current,
    };
  }

  async exportConceptsExcel(
    user: AuthUser,
    shopId: string,
    filters: {
      from?: string;
      to?: string;
      kind?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
      conceptId?: string;
    },
  ) {
    const shop = await this.shops.findOne(user, shopId);
    const data = await this.conceptsAnalytics(user, shopId, filters);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const kindLabel = (kind: string) =>
      kind === 'INCOME' ? 'Ingreso' : kind === 'EXPENSE' ? 'Egreso' : kind === 'TRANSFER' ? 'Transferencia' : kind;

    const monthNames = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];
    const kindTitle =
      filters.kind === 'EXPENSE'
        ? 'Egresos'
        : filters.kind === 'INCOME'
          ? 'Ingresos'
          : filters.kind === 'TRANSFER'
            ? 'Transferencias'
            : 'Conceptos';
    let banner = kindTitle.toUpperCase();
    if (data.from && data.to) {
      const [fy, fm] = data.from.split('-').map(Number);
      const [ty, tm] = data.to.split('-').map(Number);
      if (fy === ty && fm === tm) {
        banner = `${kindTitle.toUpperCase()} ${(monthNames[fm - 1] ?? '').toUpperCase()} ${fy}`;
      } else {
        banner = `${kindTitle.toUpperCase()} ${data.from} – ${data.to}`;
      }
    }

    const wsPivot = wb.addWorksheet('Conceptos');
    wsPivot.mergeCells('A1:C1');
    wsPivot.getCell('A1').value = banner;
    wsPivot.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF003366' } };
    wsPivot.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD6EAF8' },
    };
    wsPivot.getCell('A3').value = 'Concepto validado';
    wsPivot.getCell('B3').value = 'SUM de Importe $';
    wsPivot.getCell('C3').value = '%';
    wsPivot.getRow(3).font = { bold: true };
    wsPivot.getRow(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEEEEEE' },
    };
    wsPivot.getCell('B3').alignment = { horizontal: 'right' };
    wsPivot.getCell('C3').alignment = { horizontal: 'right' };
    wsPivot.getColumn(1).width = 36;
    wsPivot.getColumn(2).width = 20;
    wsPivot.getColumn(3).width = 12;
    let excelTotal = 0;
    data.byConcept.forEach((r, i) => {
      excelTotal += r.amount;
      const row = wsPivot.addRow([r.name, r.amount, r.share]);
      row.getCell(2).numFmt = '"$" #,##0.00';
      row.getCell(3).numFmt = '0.00%';
      if (i % 2 === 1) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF7F9FB' },
        };
      }
    });
    const totalRow = wsPivot.addRow(['Suma total', excelTotal, 1]);
    totalRow.font = { bold: true };
    totalRow.getCell(2).numFmt = '"$" #,##0.00';
    totalRow.getCell(3).numFmt = '0.00%';
    totalRow.border = { top: { style: 'medium' } };

    const wsSum = wb.addWorksheet('Resumen');
    wsSum.columns = [
      { header: 'Indicador', key: 'k', width: 28 },
      { header: 'Valor', key: 'v', width: 18 },
    ];
    wsSum.addRow({ k: 'Local', v: shop.name });
    wsSum.addRow({ k: 'Desde', v: data.from ?? '' });
    wsSum.addRow({ k: 'Hasta', v: data.to ?? '' });
    wsSum.addRow({ k: 'Movimientos', v: data.totals.movementCount });
    wsSum.addRow({ k: 'Ingresos', v: data.totals.income });
    wsSum.addRow({ k: 'Egresos', v: data.totals.expense });
    wsSum.addRow({ k: 'Transferencias', v: data.totals.transfer });
    wsSum.addRow({ k: 'Resultado (ing. − egr.)', v: data.totals.net });
    wsSum.addRow({ k: 'Sin concepto (cant.)', v: data.totals.withoutConceptCount });
    wsSum.addRow({ k: 'Sin concepto ($)', v: data.totals.withoutConceptAmount });
    wsSum.getRow(1).font = { bold: true };

    const wsCon = wb.addWorksheet('Detalle');
    wsCon.columns = [
      { header: 'Concepto', key: 'name', width: 28 },
      { header: 'Tipo', key: 'kind', width: 16 },
      { header: 'Movimientos', key: 'count', width: 14 },
      { header: 'Importe $', key: 'amount', width: 16 },
      { header: 'Promedio $', key: 'avg', width: 14 },
      { header: 'Participación %', key: 'share', width: 16 },
    ];
    for (const r of data.byConcept) {
      wsCon.addRow({
        name: r.name,
        kind: kindLabel(r.kind),
        count: r.count,
        amount: r.amount,
        avg: r.avgAmount,
        share: Math.round(r.share * 1000) / 10,
      });
    }
    wsCon.getRow(1).font = { bold: true };

    const wsDay = wb.addWorksheet('Por día');
    wsDay.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Movimientos', key: 'count', width: 14 },
      { header: 'Ingresos $', key: 'income', width: 14 },
      { header: 'Egresos $', key: 'expense', width: 14 },
      { header: 'Transferencias $', key: 'transfer', width: 18 },
    ];
    for (const d of data.byDay) {
      wsDay.addRow({
        date: d.businessDate,
        count: d.count,
        income: d.income,
        expense: d.expense,
        transfer: d.transfer,
      });
    }
    wsDay.getRow(1).font = { bold: true };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const from = data.from ?? 'inicio';
    const to = data.to ?? 'fin';
    return {
      buffer,
      filename: `conceptos-${this.fileSlug(shop.name || shop.slug)}-${from}_${to}.xlsx`,
    };
  }

  private aggregateConceptRows(
    rows: Array<{
      conceptId?: string | null;
      conceptName: string;
      kind: string;
      amountUyu: number;
      businessDate: string;
    }>,
  ) {
    const kindMap = new Map<string, { kind: string; count: number; amount: number }>();
    const conceptMap = new Map<
      string,
      {
        conceptId: string | null;
        name: string;
        kind: string;
        count: number;
        amount: number;
      }
    >();
    const dayMap = new Map<
      string,
      { businessDate: string; count: number; income: number; expense: number; transfer: number }
    >();
    let withoutConceptCount = 0;
    let withoutConceptAmount = 0;

    for (const r of rows) {
      const amount = n(r.amountUyu);
      const kindRow = kindMap.get(r.kind) ?? { kind: r.kind, count: 0, amount: 0 };
      kindRow.count += 1;
      kindRow.amount += amount;
      kindMap.set(r.kind, kindRow);

      const key = r.conceptId ?? `name:${r.conceptName}`;
      const c = conceptMap.get(key) ?? {
        conceptId: r.conceptId ?? null,
        name: r.conceptName,
        kind: r.kind,
        count: 0,
        amount: 0,
      };
      c.count += 1;
      c.amount += amount;
      conceptMap.set(key, c);

      const day =
        dayMap.get(r.businessDate) ?? {
          businessDate: r.businessDate,
          count: 0,
          income: 0,
          expense: 0,
          transfer: 0,
        };
      day.count += 1;
      if (r.kind === 'INCOME') day.income += amount;
      else if (r.kind === 'EXPENSE') day.expense += amount;
      else day.transfer += amount;
      dayMap.set(r.businessDate, day);

      if (!r.conceptId) {
        withoutConceptCount += 1;
        withoutConceptAmount += amount;
      }
    }

    const kindTotal = [...kindMap.values()].reduce((s, i) => s + i.amount, 0);
    const byKind = ['INCOME', 'EXPENSE', 'TRANSFER']
      .map((kind) => kindMap.get(kind))
      .filter((x): x is { kind: string; count: number; amount: number } => !!x)
      .map((i) => ({
        ...i,
        share: kindTotal > 0 ? i.amount / kindTotal : 0,
      }));

    const conceptTotal = [...conceptMap.values()].reduce((s, i) => s + i.amount, 0);
    const byConcept = [...conceptMap.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((i) => ({
        ...i,
        avgAmount: i.count > 0 ? i.amount / i.count : 0,
        share: conceptTotal > 0 ? i.amount / conceptTotal : 0,
      }));

    const income = kindMap.get('INCOME')?.amount ?? 0;
    const expense = kindMap.get('EXPENSE')?.amount ?? 0;
    const transfer = kindMap.get('TRANSFER')?.amount ?? 0;

    return {
      totals: {
        movementCount: rows.length,
        income,
        expense,
        transfer,
        net: income - expense,
        withoutConceptCount,
        withoutConceptAmount,
        avgAmount: rows.length ? conceptTotal / rows.length : 0,
      },
      byKind,
      byConcept,
      byDay: [...dayMap.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
    };
  }

  private inferMovementKind(r: {
    conceptKind?: string | null;
    fromAccountName?: string | null;
    toAccountName?: string | null;
  }): 'INCOME' | 'EXPENSE' | 'TRANSFER' {
    if (r.conceptKind === 'INCOME' || r.conceptKind === 'EXPENSE' || r.conceptKind === 'TRANSFER') {
      return r.conceptKind;
    }
    const to = (r.toAccountName ?? '').toLowerCase();
    const from = (r.fromAccountName ?? '').toLowerCase();
    if (to.includes('egreso') || from.includes('egreso')) return 'EXPENSE';
    if (to.includes('ingreso') || from.includes('ingreso')) return 'INCOME';
    return 'TRANSFER';
  }

  async movementsSummary(user: AuthUser, shopId: string, filters: ClosingListFilters) {
    const [expenses, balances, movements] = await Promise.all([
      this.movementsService.expensesByConcept(user, shopId, {
        from: filters.from,
        to: filters.to,
      }),
      this.movementsService.balances(user, shopId, {
        from: filters.from,
        to: filters.to,
      }),
      this.movementsService.list(user, shopId, {
        from: filters.from,
        to: filters.to,
      }),
    ]);
    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      movementCount: movements.length,
      expenses,
      balances,
    };
  }

  async exportExcel(user: AuthUser, shopId: string, filters: ClosingListFilters) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const rows = await this.filteredRows(shopId, filters);
    const movRows = await this.movementsService.list(user, shopId, {
      from: filters.from,
      to: filters.to,
    });
    const expenses = await this.movementsService.expensesByConcept(user, shopId, {
      from: filters.from,
      to: filters.to,
    });
    const balances = await this.movementsService.balances(user, shopId, {
      from: filters.from,
      to: filters.to,
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const wsClosings = wb.addWorksheet('Cierres');
    wsClosings.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Caja', key: 'caja', width: 12 },
      { header: 'PVS', key: 'pvs', width: 12 },
      { header: 'Efectivo', key: 'cash', width: 12 },
      { header: 'MP', key: 'mp', width: 12 },
      { header: 'Delivery', key: 'delivery', width: 12 },
      { header: 'Transferencia', key: 'transfer', width: 12 },
      { header: 'Cuenta DNI', key: 'dni', width: 12 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Retiro', key: 'withdrawn', width: 12 },
      { header: 'Quién se lo lleva', key: 'who', width: 18 },
      { header: 'Unidades', key: 'units', width: 10 },
      { header: 'Comensales', key: 'covers', width: 12 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Notas', key: 'notes', width: 40 },
    ];
    for (const r of rows) {
      wsClosings.addRow({
        date: r.businessDate,
        caja: n(r.posSystemAmount),
        pvs: n(r.cardAmount),
        cash: n(r.cashAmount),
        mp: n(r.mercadoPagoAmount),
        delivery: n(r.deliveryAppsAmount),
        transfer: n(r.transferAmount),
        dni: n(r.accountDniAmount),
        total: n(r.declaredTotal),
        withdrawn: n(r.cashWithdrawn),
        who: r.cashWithdrawnByName ?? '',
        units: r.unitsSold ?? '',
        covers: r.coversCount ?? '',
        status: closingStatusLabel(r.status),
        notes: r.notes ?? '',
      });
    }
    wsClosings.getRow(1).font = { bold: true };

    const wsMov = wb.addWorksheet('Movimientos');
    wsMov.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Cuenta Emisora', key: 'from', width: 16 },
      { header: 'Cuenta Receptora', key: 'to', width: 16 },
      { header: 'Descripción', key: 'desc', width: 36 },
      { header: 'Importe $', key: 'uyu', width: 14 },
      { header: 'Cotización dólar', key: 'rate', width: 14 },
      { header: 'Importe USD', key: 'usd', width: 12 },
      { header: 'Concepto validado', key: 'concept', width: 22 },
      { header: 'Facturado', key: 'inv', width: 10 },
      { header: 'Factura N°', key: 'invN', width: 12 },
      { header: 'Cierre', key: 'closing', width: 12 },
    ];
    for (const m of movRows) {
      wsMov.addRow({
        date: m.businessDate,
        from: m.fromAccountName,
        to: m.toAccountName,
        desc: m.description ?? '',
        uyu: m.amountUyu,
        rate: m.usdRate ?? '',
        usd: m.amountUsd ?? '',
        concept: m.conceptName ?? '',
        inv: m.invoiced ? 'Sí' : 'No',
        invN: m.invoiceNumber ?? '',
        closing: m.closingId ? 'Sí' : '',
      });
    }
    wsMov.getRow(1).font = { bold: true };

    const wsExp = wb.addWorksheet('REPORTE EGRESOS');
    wsExp.columns = [
      { header: 'Concepto validado', key: 'concept', width: 28 },
      { header: 'SUM de Importe $', key: 'total', width: 16 },
      { header: '%', key: 'share', width: 10 },
    ];
    for (const i of expenses.items) {
      wsExp.addRow({
        concept: i.conceptName,
        total: i.total,
        share: i.share,
      });
    }
    wsExp.addRow({ concept: 'Suma total', total: expenses.total, share: 1 });
    wsExp.getRow(1).font = { bold: true };

    const wsBal = wb.addWorksheet('Saldos');
    wsBal.columns = [
      { key: 'name', width: 22 },
      { key: 'balance', width: 16 },
    ];
    wsBal.mergeCells('A1:B1');
    wsBal.getCell('A1').value = 'SALDOS';
    wsBal.getCell('A1').font = { bold: true };
    wsBal.getCell('A1').alignment = { horizontal: 'center' };
    wsBal.getCell('A2').value = 'Cuenta';
    wsBal.getCell('B2').value = 'Saldo';
    wsBal.getCell('A2').font = { bold: true };
    wsBal.getCell('B2').font = { bold: true };
    wsBal.getCell('A2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' },
    };
    wsBal.getCell('B2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' },
    };
    wsBal.getCell('B2').alignment = { horizontal: 'center' };
    let balTotal = 0;
    for (const a of balances.accounts) {
      balTotal += n(a.balance);
      const row = wsBal.addRow({ name: a.name, balance: n(a.balance) });
      row.getCell(2).numFmt = '"$"#,##0.00';
      row.getCell(2).alignment = { horizontal: 'right' };
    }
    const totalRow = wsBal.addRow({ name: 'TOTAL', balance: balTotal });
    totalRow.font = { bold: true };
    totalRow.getCell(2).numFmt = '"$"#,##0.00';
    totalRow.getCell(2).alignment = { horizontal: 'right' };
    for (let r = 1; r <= wsBal.rowCount; r++) {
      for (const col of ['A', 'B']) {
        const cell = wsBal.getCell(`${col}${r}`);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    }

    if (filters.from && filters.to) {
      const att = await this.attendance.find({
        where: {
          shopId,
          date: Between(filters.from, filters.to),
        },
        relations: ['employee'],
        order: { date: 'ASC' },
      });
      const wsAtt = wb.addWorksheet('Presentismo');
      wsAtt.columns = [
        { header: 'Colaborador', key: 'name', width: 18 },
        { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Presente', key: 'present', width: 10 },
        { header: 'Feriado', key: 'holiday', width: 10 },
        { header: 'Horas extras', key: 'ot', width: 12 },
      ];
      for (const d of att) {
        wsAtt.addRow({
          name: d.employee?.fullName ?? d.employeeId,
          date: d.date,
          present: d.isPresent ? 'Sí' : 'No',
          holiday: d.isHoliday ? 'Sí' : 'No',
          ot: n(d.overtimeHours),
        });
      }
      wsAtt.getRow(1).font = { bold: true };

      const periods = await this.payroll.listInRange(shopId, filters.from, filters.to);
      if (periods.length) {
        const wsPay = wb.addWorksheet('Liquidación');
        wsPay.columns = [
          { header: 'Período', key: 'period', width: 12 },
          { header: 'Empleado', key: 'name', width: 18 },
          { header: 'Días', key: 'days', width: 8 },
          { header: 'Feriados', key: 'hol', width: 10 },
          { header: 'Sueldo base', key: 'base', width: 12 },
          { header: 'Horas extras $', key: 'ot', width: 14 },
          { header: 'Presentismo', key: 'bonus', width: 12 },
          { header: 'Total', key: 'total', width: 12 },
          { header: 'Estado', key: 'status', width: 10 },
        ];
        for (const p of periods) {
          for (const l of p.lines ?? []) {
            wsPay.addRow({
              period: p.fromDate && p.toDate
                ? `${p.fromDate} → ${p.toDate}`
                : `${p.year}-${String(p.month).padStart(2, '0')}`,
              name: l.employee?.fullName ?? l.employeeId,
              days: n(l.daysWorked),
              hol: n(l.holidayDays),
              base: n(l.baseSalarySnapshot),
              ot: n(l.overtimeAmount),
              bonus: n(l.attendanceBonus),
              total: n(l.total),
              status: p.status,
            });
          }
        }
        wsPay.getRow(1).font = { bold: true };
      }
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const from = filters.from ?? 'inicio';
    const to = filters.to ?? 'fin';
    const shopSlug = this.fileSlug(shop.name || shop.slug);
    const filename = `cierres-${shopSlug}-${from}_${to}.xlsx`;
    return { buffer, filename };
  }

  private fileSlug(name: string): string {
    const raw = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return raw || 'local';
  }
}
