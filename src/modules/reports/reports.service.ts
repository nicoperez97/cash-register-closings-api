import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { ShopsService } from '../shops/shops.service';
import { MovementsService } from '../movements/movements.service';
import { PayrollService } from '../payroll/payroll.service';
import { AuthUser } from '../../common/decorators';
import { closingStatusLabel } from '../../common/labels.es';
import {
  applyClosingFilters,
  ClosingListFilters,
} from '../closings/closing-filters';

const n = (v?: string | number | null) => Number(v ?? 0);

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

    const totals = rows.reduce(
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
        declaredTotal: n(r.declaredTotal),
        cardAmount: n(r.cardAmount),
        cashAmount: n(r.cashAmount),
        cashWithdrawn: n(r.cashWithdrawn),
        cashWithdrawnByName: r.cashWithdrawnByName,
        difference: n(r.difference),
        status: closingStatusLabel(r.status),
        statusCode: r.status,
      })),
    };
  }

  async expensesByConcept(user: AuthUser, shopId: string, filters: ClosingListFilters) {
    return this.movementsService.expensesByConcept(user, shopId, {
      from: filters.from,
      to: filters.to,
    });
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
              period: `${p.year}-${String(p.month).padStart(2, '0')}`,
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
