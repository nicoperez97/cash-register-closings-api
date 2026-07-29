import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { AuthUser } from '../../common/decorators';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { ShopsService } from '../shops/shops.service';

export interface SalesProductsFilters {
  from: string;
  to: string;
  q?: string | null;
  category?: string | null;
  paymentCode?: string | null;
  salesSystemId?: string | null;
}

export interface SalesProductRow {
  productCode: string | null;
  productName: string | null;
  category: string | null;
  qty: number;
  amount: number;
  ticketCount: number;
  share: number;
  avgTicketAmount: number;
}

export interface SalesCategoryRow {
  category: string;
  productCount: number;
  qty: number;
  amount: number;
  ticketCount: number;
  share: number;
}

export interface SalesProductsSummary {
  shopId: string;
  from: string;
  to: string;
  totals: {
    qty: number;
    amount: number;
    lineCount: number;
    productCount: number;
    categoryCount: number;
    ticketCount: number;
    avgTicketAmount: number;
  };
  products: SalesProductRow[];
  categories: SalesCategoryRow[];
  filterOptions: {
    categories: string[];
    paymentCodes: string[];
  };
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

@Injectable()
export class SalesProductsAnalyticsService {
  constructor(
    @InjectRepository(PosSaleTicketLine)
    private readonly lines: Repository<PosSaleTicketLine>,
    @InjectRepository(PosProduct)
    private readonly products: Repository<PosProduct>,
    private readonly shops: ShopsService,
  ) {}

  async summary(
    user: AuthUser,
    shopId: string,
    filters: SalesProductsFilters,
  ): Promise<SalesProductsSummary> {
    this.shops.assertShopAccess(user, shopId);

    const base = this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', {
        from: filters.from,
        to: filters.to,
      });

    this.applyFilters(base, filters);

    const productRaw = await base
      .clone()
      .select('l.productCode', 'productCode')
      .addSelect('l.productName', 'productName')
      .addSelect('MAX(l.category)', 'category')
      .addSelect('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .groupBy('l.productCode')
      .addGroupBy('l.productName')
      .orderBy('amount', 'DESC')
      .getRawMany();

    const categoryRaw = await base
      .clone()
      .select("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')", 'category')
      .addSelect('COUNT(DISTINCT CONCAT(COALESCE(l.productCode, \'\'), \'|\', COALESCE(l.productName, \'\')))', 'productCount')
      .addSelect('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .groupBy("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')")
      .orderBy('amount', 'DESC')
      .getRawMany();

    const totalsRaw = await base
      .clone()
      .select('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(l.id)', 'lineCount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .getRawOne();

    const totalAmount = n(totalsRaw?.amount);
    const ticketCount = n(totalsRaw?.ticketCount);

    const products: SalesProductRow[] = productRaw.map((r) => {
      const amount = n(r.amount);
      const tc = n(r.ticketCount);
      return {
        productCode: r.productCode ?? null,
        productName: r.productName ?? null,
        category: r.category ?? null,
        qty: n(r.qty),
        amount,
        ticketCount: tc,
        share: totalAmount > 0 ? amount / totalAmount : 0,
        avgTicketAmount: tc > 0 ? amount / tc : 0,
      };
    });

    const categories: SalesCategoryRow[] = categoryRaw.map((r) => {
      const amount = n(r.amount);
      return {
        category: String(r.category ?? 'Sin rubro'),
        productCount: n(r.productCount),
        qty: n(r.qty),
        amount,
        ticketCount: n(r.ticketCount),
        share: totalAmount > 0 ? amount / totalAmount : 0,
      };
    });

    const filterOptions = await this.filterOptions(shopId, filters.from, filters.to);

    return {
      shopId,
      from: filters.from,
      to: filters.to,
      totals: {
        qty: n(totalsRaw?.qty),
        amount: totalAmount,
        lineCount: n(totalsRaw?.lineCount),
        productCount: products.length,
        categoryCount: categories.filter((c) => c.category !== 'Sin rubro').length,
        ticketCount,
        avgTicketAmount: ticketCount > 0 ? totalAmount / ticketCount : 0,
      },
      products,
      categories,
      filterOptions,
    };
  }

  async listCatalog(user: AuthUser, shopId: string, q?: string | null) {
    this.shops.assertShopAccess(user, shopId);
    await this.ensureCatalogFromTickets(shopId);
    const qb = this.products
      .createQueryBuilder('p')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.active = 1')
      .orderBy('p.productName', 'ASC');
    if (q?.trim()) {
      qb.andWhere(
        '(p.productName LIKE :q OR p.productCode LIKE :q OR p.category LIKE :q)',
        { q: `%${q.trim()}%` },
      );
    }
    return qb.getMany();
  }

  /** Completa catálogo a partir de líneas ya importadas (migraciones / datos legacy). */
  private async ensureCatalogFromTickets(shopId: string) {
    const distinct = await this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .select('l.productCode', 'productCode')
      .addSelect('MAX(l.productName)', 'productName')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere("(l.productCode IS NOT NULL AND l.productCode <> '') OR (l.productName IS NOT NULL AND l.productName <> '')")
      .groupBy('l.productCode')
      .getRawMany();

    if (!distinct.length) return;
    await this.upsertFromLines(
      shopId,
      distinct.map((r) => ({
        productCode: r.productCode ?? null,
        productName: r.productName ?? null,
      })),
    );
  }

  async updateCatalog(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: { productName?: string | null; category?: string | null; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.products.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Producto no encontrado');

    if (dto.productName !== undefined) row.productName = dto.productName;
    if (dto.category !== undefined) row.category = dto.category?.trim() || null;
    if (dto.active !== undefined) row.active = dto.active;
    await this.products.save(row);

    // Backfill categoría en líneas históricas del mismo código
    if (dto.category !== undefined) {
      await this.lines.query(
        `UPDATE pos_sale_ticket_lines l
         INNER JOIN pos_sale_tickets t ON t.id = l.ticketId
         SET l.category = ?
         WHERE t.shopId = ? AND l.productCode = ? AND t.deletedAt IS NULL`,
        [row.category, shopId, row.productCode],
      );
    }

    return row;
  }

  /** Upsert catálogo y devolver mapa código → rubro. */
  async upsertFromLines(
    shopId: string,
    items: Array<{ productCode: string | null; productName: string | null }>,
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const byCode = new Map<string, { productCode: string; productName: string | null }>();

    for (const item of items) {
      const code = (item.productCode || item.productName || '').trim();
      if (!code) continue;
      if (!byCode.has(code)) {
        byCode.set(code, {
          productCode: code,
          productName: item.productName?.trim() || item.productCode?.trim() || null,
        });
      }
    }

    if (!byCode.size) return map;

    const codes = [...byCode.keys()];
    const existing = await this.products
      .createQueryBuilder('p')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.productCode IN (:...codes)', { codes })
      .getMany();
    const existingByCode = new Map(existing.map((p) => [p.productCode, p]));

    const toSave: PosProduct[] = [];
    for (const [code, meta] of byCode) {
      let row = existingByCode.get(code);
      if (row) {
        if (meta.productName && meta.productName !== row.productName) {
          row.productName = meta.productName;
          toSave.push(row);
        }
        map.set(code, row.category ?? null);
      } else {
        row = this.products.create({
          shopId,
          productCode: code,
          productName: meta.productName,
          category: null,
          active: true,
        });
        toSave.push(row);
        map.set(code, null);
      }
    }
    if (toSave.length) {
      const saved = await this.products.save(toSave);
      for (const s of saved) map.set(s.productCode, s.category ?? null);
    }
    return map;
  }

  async exportExcel(user: AuthUser, shopId: string, filters: SalesProductsFilters) {
    const summary = await this.summary(user, shopId, filters);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const moneyFmt = '$#,##0.00';
    const pctFmt = '0.0%';

    const wsP = wb.addWorksheet('Platos');
    wsP.columns = [
      { header: 'Código', key: 'code', width: 14 },
      { header: 'Plato', key: 'name', width: 36 },
      { header: 'Rubro', key: 'category', width: 20 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Importe', key: 'amount', width: 14 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: '%', key: 'share', width: 10 },
    ];
    for (const p of summary.products) {
      wsP.addRow({
        code: p.productCode,
        name: p.productName,
        category: p.category ?? 'Sin rubro',
        qty: p.qty,
        amount: p.amount,
        tickets: p.ticketCount,
        share: p.share,
      });
    }
    wsP.getColumn('amount').numFmt = moneyFmt;
    wsP.getColumn('share').numFmt = pctFmt;

    const wsC = wb.addWorksheet('Rubros');
    wsC.columns = [
      { header: 'Rubro', key: 'category', width: 28 },
      { header: 'Platos', key: 'products', width: 10 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Importe', key: 'amount', width: 14 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: '%', key: 'share', width: 10 },
    ];
    for (const c of summary.categories) {
      wsC.addRow({
        category: c.category,
        products: c.productCount,
        qty: c.qty,
        amount: c.amount,
        tickets: c.ticketCount,
        share: c.share,
      });
    }
    wsC.getColumn('amount').numFmt = moneyFmt;
    wsC.getColumn('share').numFmt = pctFmt;

    const wsT = wb.addWorksheet('Totales');
    wsT.addRow(['Desde', summary.from]);
    wsT.addRow(['Hasta', summary.to]);
    wsT.addRow(['Importe total', summary.totals.amount]);
    wsT.addRow(['Cantidad total', summary.totals.qty]);
    wsT.addRow(['Tickets', summary.totals.ticketCount]);
    wsT.addRow(['Platos distintos', summary.totals.productCount]);
    wsT.addRow(['Rubros', summary.totals.categoryCount]);
    wsT.addRow(['Ticket promedio', summary.totals.avgTicketAmount]);
    wsT.getCell('B3').numFmt = moneyFmt;
    wsT.getCell('B8').numFmt = moneyFmt;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `ventas-platos-${filters.from}_${filters.to}.xlsx`,
    };
  }

  private applyFilters(
    qb: ReturnType<Repository<PosSaleTicketLine>['createQueryBuilder']>,
    filters: SalesProductsFilters,
  ) {
    if (filters.q?.trim()) {
      qb.andWhere(
        '(l.productName LIKE :q OR l.productCode LIKE :q OR l.category LIKE :q)',
        { q: `%${filters.q.trim()}%` },
      );
    }
    if (filters.category?.trim()) {
      if (filters.category.trim() === 'Sin rubro') {
        qb.andWhere("(l.category IS NULL OR TRIM(l.category) = '')");
      } else {
        qb.andWhere('l.category = :category', { category: filters.category.trim() });
      }
    }
    if (filters.paymentCode?.trim()) {
      qb.andWhere('t.paymentCode = :paymentCode', {
        paymentCode: filters.paymentCode.trim(),
      });
    }
    if (filters.salesSystemId?.trim()) {
      qb.andWhere('t.salesSystemId = :salesSystemId', {
        salesSystemId: filters.salesSystemId.trim(),
      });
    }
  }

  private async filterOptions(shopId: string, from: string, to: string) {
    const cats = await this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .select("DISTINCT COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')", 'category')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
      .orderBy('category', 'ASC')
      .getRawMany();

    const pays = await this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .select('DISTINCT t.paymentCode', 'paymentCode')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
      .andWhere('t.paymentCode IS NOT NULL')
      .andWhere("t.paymentCode <> ''")
      .orderBy('paymentCode', 'ASC')
      .getRawMany();

    return {
      categories: cats.map((c) => String(c.category)),
      paymentCodes: pays.map((p) => String(p.paymentCode)),
    };
  }
}

export function parseSalesProductsFilters(
  query: Record<string, string | undefined>,
): SalesProductsFilters | null {
  const from = query.from?.trim();
  const to = query.to?.trim();
  if (!from || !to) return null;
  return {
    from,
    to,
    q: query.q?.trim() || null,
    category: query.category?.trim() || null,
    paymentCode: query.paymentCode?.trim() || null,
    salesSystemId: query.salesSystemId?.trim() || null,
  };
}
