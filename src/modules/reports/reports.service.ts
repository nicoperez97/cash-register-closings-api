import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ShopsService } from '../shops/shops.service';
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
    private readonly shops: ShopsService,
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

  async exportExcel(user: AuthUser, shopId: string, filters: ClosingListFilters) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const rows = await this.filteredRows(shopId, filters);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cierres');
    ws.columns = [
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
      ws.addRow({
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

    ws.getRow(1).font = { bold: true };
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
