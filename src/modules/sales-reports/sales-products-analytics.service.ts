import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { AuthUser } from '../../common/decorators';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { ShopsService } from '../shops/shops.service';
import {
  allSeedProducts,
  guessByCodeRange,
  guessWineVarietyFromName,
  looksLikeWineWithoutVariety,
  normProductCode,
} from './pos-catalog.seed';

export interface SalesProductsFilters {
  from: string;
  to: string;
  q?: string | null;
  category?: string | null;
  subcategory?: string | null;
  paymentCode?: string | null;
  salesSystemId?: string | null;
}

export interface SalesProductRow {
  productCode: string | null;
  productName: string | null;
  category: string | null;
  subcategory: string | null;
  qty: number;
  amount: number;
  ticketCount: number;
  share: number;
  avgTicketAmount: number;
  /** Contribución al ticket promedio del período. */
  ticketContribution: number;
  /** Δ % vs período anterior (mismo filtro de fechas corrido). */
  trendPct: number | null;
}

export interface SalesCategoryRow {
  category: string;
  productCount: number;
  qty: number;
  amount: number;
  ticketCount: number;
  share: number;
}

export interface SalesSubcategoryRow {
  category: string;
  subcategory: string;
  productCount: number;
  qty: number;
  amount: number;
  ticketCount: number;
  share: number;
}

export interface SalesDayRow {
  date: string;
  qty: number;
  amount: number;
  ticketCount: number;
}

export interface SalesPaymentRow {
  paymentCode: string;
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
    subcategoryCount: number;
    ticketCount: number;
    avgTicketAmount: number;
    maxTicketAmount: number;
    minTicketAmount: number;
    dishesPerTicket: number;
    top10Share: number;
    amountDeltaPct: number | null;
  };
  products: SalesProductRow[];
  categories: SalesCategoryRow[];
  subcategories: SalesSubcategoryRow[];
  /** Serie diaria (importe / unidades / tickets). */
  byDay: SalesDayRow[];
  /** Desglose por forma de pago POS. */
  byPayment: SalesPaymentRow[];
  /** Pareto acumulado de platos (ordenados por importe). */
  pareto: Array<{ label: string; amount: number; cumulativeShare: number }>;
  /** Evolución diaria por rubro (top 5 + otros). */
  categoryByDay: Array<{ date: string; category: string; amount: number }>;
  /** Comparación mismo día de la semana anterior (por fecha del período). */
  sameWeekdayCompare: Array<{
    date: string;
    amount: number;
    previousDate: string;
    previousAmount: number;
    deltaPct: number | null;
  }>;
  filterOptions: {
    categories: string[];
    subcategories: string[];
    paymentCodes: string[];
  };
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/** Normaliza DATE/Date/string a YYYY-MM-DD (evita "Wed Mar 18" al String(date)). */
function toIsoDateOnly(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }
  return s.slice(0, 10);
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
      .addSelect('MAX(l.subcategory)', 'subcategory')
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

    const subcategoryRaw = await base
      .clone()
      .select("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')", 'category')
      .addSelect("COALESCE(NULLIF(TRIM(l.subcategory), ''), 'Sin subrubro')", 'subcategory')
      .addSelect('COUNT(DISTINCT CONCAT(COALESCE(l.productCode, \'\'), \'|\', COALESCE(l.productName, \'\')))', 'productCount')
      .addSelect('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .groupBy("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')")
      .addGroupBy("COALESCE(NULLIF(TRIM(l.subcategory), ''), 'Sin subrubro')")
      .orderBy('amount', 'DESC')
      .getRawMany();

    const totalsRaw = await base
      .clone()
      .select('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(l.id)', 'lineCount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .getRawOne();

    const dayRaw = await base
      .clone()
      .select('t.businessDate', 'date')
      .addSelect('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .groupBy('t.businessDate')
      .orderBy('t.businessDate', 'ASC')
      .getRawMany();

    const paymentRaw = await base
      .clone()
      .select("COALESCE(NULLIF(TRIM(t.paymentCode), ''), 'Sin pago')", 'paymentCode')
      .addSelect('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .groupBy("COALESCE(NULLIF(TRIM(t.paymentCode), ''), 'Sin pago')")
      .orderBy('amount', 'DESC')
      .getRawMany();

    const totalAmount = n(totalsRaw?.amount);
    const ticketCount = n(totalsRaw?.ticketCount);

    const products: SalesProductRow[] = productRaw.map((r) => {
      const amount = n(r.amount);
      const tc = n(r.ticketCount);
      return {
        productCode: r.productCode ?? null,
        productName: r.productName ?? null,
        category: r.category ?? null,
        subcategory: r.subcategory ?? null,
        qty: n(r.qty),
        amount,
        ticketCount: tc,
        share: totalAmount > 0 ? amount / totalAmount : 0,
        avgTicketAmount: tc > 0 ? amount / tc : 0,
        ticketContribution: 0,
        trendPct: null,
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

    const subcategories: SalesSubcategoryRow[] = subcategoryRaw.map((r) => {
      const amount = n(r.amount);
      return {
        category: String(r.category ?? 'Sin rubro'),
        subcategory: String(r.subcategory ?? 'Sin subrubro'),
        productCount: n(r.productCount),
        qty: n(r.qty),
        amount,
        ticketCount: n(r.ticketCount),
        share: totalAmount > 0 ? amount / totalAmount : 0,
      };
    });

    const byDay: SalesDayRow[] = dayRaw.map((r) => ({
      date: toIsoDateOnly(r.date),
      qty: n(r.qty),
      amount: n(r.amount),
      ticketCount: n(r.ticketCount),
    }));

    const byPayment: SalesPaymentRow[] = paymentRaw.map((r) => {
      const amount = n(r.amount);
      return {
        paymentCode: String(r.paymentCode ?? 'Sin pago'),
        qty: n(r.qty),
        amount,
        ticketCount: n(r.ticketCount),
        share: totalAmount > 0 ? amount / totalAmount : 0,
      };
    });

    const filterOptions = await this.filterOptions(shopId, filters.from, filters.to);

    const ticketAgg = await base
      .clone()
      .select('t.id', 'ticketId')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('SUM(l.qty)', 'qty')
      .groupBy('t.id')
      .getRawMany();
    const ticketAmounts = ticketAgg.map((r) => n(r.amount)).filter((v) => v > 0);
    const maxTicketAmount = ticketAmounts.length ? Math.max(...ticketAmounts) : 0;
    const minTicketAmount = ticketAmounts.length ? Math.min(...ticketAmounts) : 0;
    const dishesPerTicket =
      ticketCount > 0 ? Math.round((n(totalsRaw?.qty) / ticketCount) * 100) / 100 : 0;
    const top10Amount = products.slice(0, 10).reduce((s, p) => s + p.amount, 0);
    const top10Share = totalAmount > 0 ? top10Amount / totalAmount : 0;

    let cum = 0;
    const pareto = products.slice(0, 30).map((p) => {
      cum += p.amount;
      return {
        label: p.productName || p.productCode || '—',
        amount: p.amount,
        cumulativeShare: totalAmount > 0 ? cum / totalAmount : 0,
      };
    });

    const topCats = categories.slice(0, 5).map((c) => c.category);
    const catDayRaw = await base
      .clone()
      .select('t.businessDate', 'date')
      .addSelect("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')", 'category')
      .addSelect('SUM(l.amount)', 'amount')
      .groupBy('t.businessDate')
      .addGroupBy("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')")
      .orderBy('t.businessDate', 'ASC')
      .getRawMany();
    const categoryByDay = catDayRaw.map((r) => {
      const cat = String(r.category ?? 'Sin rubro');
      return {
        date: toIsoDateOnly(r.date),
        category: topCats.includes(cat) ? cat : 'Otros',
        amount: n(r.amount),
      };
    });

    // Período anterior de igual duración
    const fromD = new Date(`${filters.from}T12:00:00.000Z`);
    const toD = new Date(`${filters.to}T12:00:00.000Z`);
    const days =
      Math.round((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const prevTo = new Date(fromD);
    prevTo.setUTCDate(prevTo.getUTCDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
    const prevFromIso = toIsoDateOnly(prevFrom);
    const prevToIso = toIsoDateOnly(prevTo);

    const prevBase = this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', {
        from: prevFromIso,
        to: prevToIso,
      });
    this.applyFilters(prevBase, { ...filters, from: prevFromIso, to: prevToIso });

    const prevTotalsRaw = await prevBase
      .clone()
      .select('SUM(l.amount)', 'amount')
      .getRawOne();
    const prevAmount = n(prevTotalsRaw?.amount);
    const amountDeltaPct =
      prevAmount > 0
        ? Math.round(((totalAmount - prevAmount) / prevAmount) * 1000) / 10
        : totalAmount === 0
          ? 0
          : null;

    const prevProductRaw = await prevBase
      .clone()
      .select('l.productCode', 'productCode')
      .addSelect('l.productName', 'productName')
      .addSelect('SUM(l.amount)', 'amount')
      .groupBy('l.productCode')
      .addGroupBy('l.productName')
      .getRawMany();
    const prevByKey = new Map<string, number>();
    for (const r of prevProductRaw) {
      const key = `${r.productCode ?? ''}|${r.productName ?? ''}`;
      prevByKey.set(key, n(r.amount));
    }
    for (const p of products) {
      const key = `${p.productCode ?? ''}|${p.productName ?? ''}`;
      const prev = prevByKey.get(key) ?? 0;
      p.trendPct =
        prev > 0
          ? Math.round(((p.amount - prev) / prev) * 1000) / 10
          : p.amount === 0
            ? 0
            : null;
      p.ticketContribution =
        ticketCount > 0 ? Math.round((p.amount / ticketCount) * 100) / 100 : 0;
    }

    const weekdayFrom = new Date(fromD);
    weekdayFrom.setUTCDate(weekdayFrom.getUTCDate() - 7);
    const weekdayTo = new Date(toD);
    weekdayTo.setUTCDate(weekdayTo.getUTCDate() - 7);
    const weekdayFromIso = toIsoDateOnly(weekdayFrom);
    const weekdayToIso = toIsoDateOnly(weekdayTo);
    const weekdayBase = this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', {
        from: weekdayFromIso,
        to: weekdayToIso,
      });
    this.applyFilters(weekdayBase, {
      ...filters,
      from: weekdayFromIso,
      to: weekdayToIso,
    });
    const weekdayDayRaw = await weekdayBase
      .clone()
      .select('t.businessDate', 'date')
      .addSelect('SUM(l.amount)', 'amount')
      .groupBy('t.businessDate')
      .getRawMany();
    const weekdayDayMap = new Map<string, number>();
    for (const r of weekdayDayRaw) {
      weekdayDayMap.set(toIsoDateOnly(r.date), n(r.amount));
    }
    const sameWeekdayCompare = byDay.map((d) => {
      const dt = new Date(`${d.date}T12:00:00.000Z`);
      const prevDt = new Date(dt);
      prevDt.setUTCDate(prevDt.getUTCDate() - 7);
      const previousDate = toIsoDateOnly(prevDt);
      const previousAmount = weekdayDayMap.get(previousDate) ?? 0;
      const deltaPct =
        previousAmount > 0
          ? Math.round(((d.amount - previousAmount) / previousAmount) * 1000) / 10
          : d.amount === 0
            ? 0
            : null;
      return {
        date: d.date,
        amount: d.amount,
        previousDate,
        previousAmount,
        deltaPct,
      };
    });

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
        subcategoryCount: subcategories.filter((s) => s.subcategory !== 'Sin subrubro').length,
        ticketCount,
        avgTicketAmount: ticketCount > 0 ? totalAmount / ticketCount : 0,
        maxTicketAmount,
        minTicketAmount,
        dishesPerTicket,
        top10Share,
        amountDeltaPct,
      },
      products,
      categories,
      subcategories,
      byDay,
      byPayment,
      pareto,
      categoryByDay,
      sameWeekdayCompare,
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
        '(p.productName LIKE :q OR p.productCode LIKE :q OR p.category LIKE :q OR p.subcategory LIKE :q)',
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
    dto: {
      productName?: string | null;
      category?: string | null;
      subcategory?: string | null;
      categoryId?: string | null;
      subcategoryId?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.products.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Producto no encontrado');

    if (dto.productName !== undefined) row.productName = dto.productName;
    if (dto.active !== undefined) row.active = dto.active;

    // Prefer IDs when provided; sync denormalized names.
    if (dto.categoryId !== undefined || dto.subcategoryId !== undefined) {
      if (dto.categoryId !== undefined) row.categoryId = dto.categoryId || null;
      if (dto.subcategoryId !== undefined) row.subcategoryId = dto.subcategoryId || null;

      if (row.categoryId) {
        const cat = await this.products.query(
          `SELECT name FROM pos_categories WHERE id = ? AND shopId = ? LIMIT 1`,
          [row.categoryId, shopId],
        );
        row.category = cat?.[0]?.name ?? null;
      } else if (dto.categoryId === null) {
        row.category = null;
      }

      if (row.subcategoryId) {
        const sub = await this.products.query(
          `SELECT name, categoryId FROM pos_subcategories WHERE id = ? AND shopId = ? LIMIT 1`,
          [row.subcategoryId, shopId],
        );
        row.subcategory = sub?.[0]?.name ?? null;
        if (sub?.[0]?.categoryId && !row.categoryId) {
          row.categoryId = sub[0].categoryId;
          const cat = await this.products.query(
            `SELECT name FROM pos_categories WHERE id = ? AND shopId = ? LIMIT 1`,
            [row.categoryId, shopId],
          );
          row.category = cat?.[0]?.name ?? row.category;
        }
      } else if (dto.subcategoryId === null) {
        row.subcategory = null;
      }
    } else {
      if (dto.category !== undefined) {
        row.category = dto.category?.trim() || null;
        row.categoryId = null;
      }
      if (dto.subcategory !== undefined) {
        row.subcategory = dto.subcategory?.trim() || null;
        row.subcategoryId = null;
      }
    }

    await this.products.save(row);

    await this.lines.query(
      `UPDATE pos_sale_ticket_lines l
       INNER JOIN pos_sale_tickets t ON t.id = l.ticketId
       SET l.category = ?, l.subcategory = ?
       WHERE t.shopId = ? AND l.productCode = ? AND t.deletedAt IS NULL`,
      [row.category, row.subcategory, shopId, row.productCode],
    );

    return row;
  }

  /** Upsert catálogo y devolver mapa código → {category, subcategory}. */
  async upsertFromLines(
    shopId: string,
    items: Array<{ productCode: string | null; productName: string | null }>,
  ): Promise<Map<string, { category: string | null; subcategory: string | null }>> {
    const map = new Map<string, { category: string | null; subcategory: string | null }>();
    const byCode = new Map<string, { productCode: string; productName: string | null }>();

    for (const item of items) {
      const code = (item.productCode || item.productName || '').trim();
      if (!code) continue;
      // Prefer numeric Restosoft codes without trailing .0
      const normalized =
        /^\d+\.0+$/.test(code) ? String(parseInt(code, 10)) : code.replace(/\.0+$/, '');
      if (!byCode.has(normalized)) {
        byCode.set(normalized, {
          productCode: normalized,
          productName: item.productName?.trim() || item.productCode?.trim() || null,
        });
      }
    }

    if (!byCode.size) return map;

    const seedByCode = new Map<string, { category: string; subcategory: string }>();
    for (const p of allSeedProducts()) {
      const c = normProductCode(p.code);
      if (c) seedByCode.set(c, { category: p.category, subcategory: p.subcategory });
    }

    const resolveNewLabels = (
      code: string,
      productName: string | null,
    ): { category: string | null; subcategory: string | null } => {
      const seed = seedByCode.get(code);
      if (seed?.category === 'VINOS' && !seed.subcategory) {
        return { category: null, subcategory: null };
      }
      if (seed) return { category: seed.category, subcategory: seed.subcategory };

      const wineSub = guessWineVarietyFromName(productName);
      if (wineSub) return { category: 'VINOS', subcategory: wineSub };

      // Vino sin cepa clara: no cargar rubro/subrubro
      if (looksLikeWineWithoutVariety(productName)) {
        return { category: null, subcategory: null };
      }

      const guess = guessByCodeRange(code);
      if (guess) return { category: guess.category, subcategory: guess.subcategory };
      return { category: null, subcategory: null };
    };

    const codes = [...byCode.keys()];
    const existing: PosProduct[] = [];
    for (let i = 0; i < codes.length; i += 400) {
      const slice = codes.slice(i, i + 400);
      const rows = await this.products
        .createQueryBuilder('p')
        .where('p.shopId = :shopId', { shopId })
        .andWhere('p.productCode IN (:...codes)', { codes: slice })
        .getMany();
      existing.push(...rows);
    }
    const existingByCode = new Map(existing.map((p) => [p.productCode, p]));

    const toSave: PosProduct[] = [];
    for (const [code, meta] of byCode) {
      let row = existingByCode.get(code);
      if (row) {
        let dirty = false;
        if (meta.productName && meta.productName !== row.productName) {
          row.productName = meta.productName;
          dirty = true;
        }
        // Completar rubro/subrubro solo si falta y podemos identificarlo (vinos: con cepa).
        if (!row.category || (row.category === 'VINOS' && !row.subcategory)) {
          const labels = resolveNewLabels(code, meta.productName ?? row.productName ?? null);
          if (labels.category && (labels.category !== 'VINOS' || labels.subcategory)) {
            row.category = labels.category;
            row.subcategory = labels.subcategory;
            dirty = true;
          }
        }
        if (dirty) toSave.push(row);
        map.set(code, {
          category: row.category ?? null,
          subcategory: row.subcategory ?? null,
        });
      } else {
        const labels = resolveNewLabels(code, meta.productName);
        row = this.products.create({
          shopId,
          productCode: code,
          productName: meta.productName,
          category: labels.category,
          subcategory: labels.subcategory,
          active: true,
        });
        toSave.push(row);
        map.set(code, {
          category: labels.category,
          subcategory: labels.subcategory,
        });
      }
    }
    if (toSave.length) {
      for (let i = 0; i < toSave.length; i += 200) {
        const saved = await this.products.save(toSave.slice(i, i + 200));
        for (const s of saved) {
          map.set(s.productCode, {
            category: s.category ?? null,
            subcategory: s.subcategory ?? null,
          });
        }
      }
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
      { header: 'Subrubro', key: 'subcategory', width: 20 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Importe', key: 'amount', width: 14 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: '%', key: 'share', width: 10 },
      { header: '$/ticket', key: 'ticketContribution', width: 12 },
      { header: 'Tendencia %', key: 'trendPct', width: 12 },
    ];
    for (const p of summary.products) {
      wsP.addRow({
        code: p.productCode,
        name: p.productName,
        category: p.category ?? 'Sin rubro',
        subcategory: p.subcategory ?? 'Sin subrubro',
        qty: p.qty,
        amount: p.amount,
        tickets: p.ticketCount,
        share: p.share,
        ticketContribution: p.ticketContribution,
        trendPct: p.trendPct,
      });
    }
    wsP.getColumn('amount').numFmt = moneyFmt;
    wsP.getColumn('share').numFmt = pctFmt;
    wsP.getColumn('ticketContribution').numFmt = moneyFmt;

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

    const wsS = wb.addWorksheet('Subrubros');
    wsS.columns = [
      { header: 'Rubro', key: 'category', width: 20 },
      { header: 'Subrubro', key: 'subcategory', width: 24 },
      { header: 'Platos', key: 'products', width: 10 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Importe', key: 'amount', width: 14 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: '%', key: 'share', width: 10 },
    ];
    for (const s of summary.subcategories) {
      wsS.addRow({
        category: s.category,
        subcategory: s.subcategory,
        products: s.productCount,
        qty: s.qty,
        amount: s.amount,
        tickets: s.ticketCount,
        share: s.share,
      });
    }
    wsS.getColumn('amount').numFmt = moneyFmt;
    wsS.getColumn('share').numFmt = pctFmt;

    const wsT = wb.addWorksheet('Totales');
    wsT.addRow(['Desde', summary.from]);
    wsT.addRow(['Hasta', summary.to]);
    wsT.addRow(['Importe total', summary.totals.amount]);
    wsT.addRow(['Cantidad total', summary.totals.qty]);
    wsT.addRow(['Tickets', summary.totals.ticketCount]);
    wsT.addRow(['Platos distintos', summary.totals.productCount]);
    wsT.addRow(['Rubros', summary.totals.categoryCount]);
    wsT.addRow(['Subrubros', summary.totals.subcategoryCount]);
    wsT.addRow(['Ticket promedio', summary.totals.avgTicketAmount]);
    wsT.getCell('B3').numFmt = moneyFmt;
    wsT.getCell('B9').numFmt = moneyFmt;

    const wsD = wb.addWorksheet('Por día');
    wsD.columns = [
      { header: 'Fecha', key: 'date', width: 14 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Importe', key: 'amount', width: 14 },
      { header: 'Tickets', key: 'tickets', width: 10 },
    ];
    for (const d of summary.byDay) {
      wsD.addRow({
        date: d.date,
        qty: d.qty,
        amount: d.amount,
        tickets: d.ticketCount,
      });
    }
    wsD.getColumn('amount').numFmt = moneyFmt;

    const wsPay = wb.addWorksheet('Por pago');
    wsPay.columns = [
      { header: 'Forma de pago', key: 'payment', width: 20 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Importe', key: 'amount', width: 14 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: '%', key: 'share', width: 10 },
    ];
    for (const p of summary.byPayment) {
      wsPay.addRow({
        payment: p.paymentCode,
        qty: p.qty,
        amount: p.amount,
        tickets: p.ticketCount,
        share: p.share,
      });
    }
    wsPay.getColumn('amount').numFmt = moneyFmt;
    wsPay.getColumn('share').numFmt = pctFmt;

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
        '(l.productName LIKE :q OR l.productCode LIKE :q OR l.category LIKE :q OR l.subcategory LIKE :q)',
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
    if (filters.subcategory?.trim()) {
      if (filters.subcategory.trim() === 'Sin subrubro') {
        qb.andWhere("(l.subcategory IS NULL OR TRIM(l.subcategory) = '')");
      } else {
        qb.andWhere('l.subcategory = :subcategory', {
          subcategory: filters.subcategory.trim(),
        });
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

    const subs = await this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .select("DISTINCT COALESCE(NULLIF(TRIM(l.subcategory), ''), 'Sin subrubro')", 'subcategory')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
      .orderBy('subcategory', 'ASC')
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
      subcategories: subs.map((s) => String(s.subcategory)),
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
    subcategory: query.subcategory?.trim() || null,
    paymentCode: query.paymentCode?.trim() || null,
    salesSystemId: query.salesSystemId?.trim() || null,
  };
}
