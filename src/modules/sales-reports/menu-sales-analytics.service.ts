import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { resolveShopCalendarDate } from '../../common/business-date';
import {
  CustomerOrder,
  CustomerOrderLine,
  CustomerOrderStatus,
} from '../../entities/customer-order.entity';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { ShopsService } from '../shops/shops.service';
import type {
  SalesCategoryRow,
  SalesDayRow,
  SalesPaymentRow,
  SalesProductRow,
  SalesProductsFilters,
  SalesProductsSummary,
  SalesSubcategoryRow,
} from './sales-products-analytics.service';

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

type AggKey = string;

type LinkedPos = {
  productCode: string;
  productName: string | null;
  category: string | null;
  subcategory: string | null;
};

export type MenuPosLinkedPreviewRow = {
  menuItemId: string;
  menuItemName: string | null;
  productCode: string;
  productName: string | null;
  category: string | null;
  subcategory: string | null;
  cartaQty: number;
  cartaAmount: number;
  posQty: number;
  posAmount: number;
  posTicketCount: number;
};

export type MenuPosLinkedPreview = {
  shopId: string;
  from: string;
  to: string;
  linkedCount: number;
  withPosSalesCount: number;
  totals: { posQty: number; posAmount: number; cartaAmount: number };
  items: MenuPosLinkedPreviewRow[];
};

/**
 * Ventas de carta: pedidos online + mostrador + comanda (customer_orders).
 * Los platos Restosoft enlazados (pos_products.menuItemId) aportan código/rubro
 * y aparecen aunque no hayan vendido en el período.
 * Opcional: merge de ventas POS enlazadas (Traer de ventas POS).
 */
@Injectable()
export class MenuSalesAnalyticsService {
  constructor(
    @InjectRepository(CustomerOrder)
    private readonly orders: Repository<CustomerOrder>,
    @InjectRepository(PosProduct)
    private readonly products: Repository<PosProduct>,
    @InjectRepository(PosSaleTicketLine)
    private readonly posLines: Repository<PosSaleTicketLine>,
    private readonly shops: ShopsService,
  ) {}

  async posLinkedPreview(
    user: AuthUser,
    shopId: string,
    filters: SalesProductsFilters,
  ): Promise<MenuPosLinkedPreview> {
    this.shops.assertShopAccess(user, shopId);
    const byMenuItem = await this.loadLinkedMap(shopId);
    const shop = await this.shops.getShopEntity(shopId);
    const menuNameById = this.menuNameMap(shop?.menu);

    const cartaSummary = await this.summary(user, shopId, {
      ...filters,
      includePosSales: false,
      posMenuItemIds: null,
    });
    const cartaByMenu = new Map<string, { qty: number; amount: number }>();
    for (const p of cartaSummary.products) {
      const mid = String(p.menuItemId ?? '').trim();
      if (!mid) continue;
      cartaByMenu.set(mid, { qty: p.qty, amount: p.amount });
    }

    const codeToMenu = new Map<string, string>();
    for (const [mid, pos] of byMenuItem) {
      codeToMenu.set(pos.productCode, mid);
    }
    const posByCode = await this.aggregatePosByCode(
      shopId,
      filters.from,
      filters.to,
      [...codeToMenu.keys()],
    );

    const items: MenuPosLinkedPreviewRow[] = [];
    for (const [menuItemId, pos] of byMenuItem) {
      const category = pos.category ?? null;
      const subcategory = pos.subcategory ?? null;
      if (filters.category && (category || 'Sin rubro') !== filters.category) continue;
      if (filters.subcategory && (subcategory || 'Sin subrubro') !== filters.subcategory) {
        continue;
      }
      if (filters.q?.trim()) {
        const q = filters.q.trim().toLowerCase();
        const hay =
          `${pos.productCode ?? ''} ${pos.productName ?? ''} ${category ?? ''} ${menuItemId}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const carta = cartaByMenu.get(menuItemId) ?? { qty: 0, amount: 0 };
      const posAgg = posByCode.get(pos.productCode) ?? { qty: 0, amount: 0, ticketCount: 0 };
      items.push({
        menuItemId,
        menuItemName: menuNameById.get(menuItemId) ?? pos.productName,
        productCode: pos.productCode,
        productName: pos.productName,
        category,
        subcategory,
        cartaQty: carta.qty,
        cartaAmount: carta.amount,
        posQty: posAgg.qty,
        posAmount: posAgg.amount,
        posTicketCount: posAgg.ticketCount,
      });
    }
    items.sort((a, b) => b.posAmount - a.posAmount || b.cartaAmount - a.cartaAmount);

    const withPos = items.filter((i) => i.posQty > 0 || i.posAmount > 0);
    return {
      shopId,
      from: filters.from,
      to: filters.to,
      linkedCount: items.length,
      withPosSalesCount: withPos.length,
      totals: {
        posQty: withPos.reduce((s, i) => s + i.posQty, 0),
        posAmount: withPos.reduce((s, i) => s + i.posAmount, 0),
        cartaAmount: items.reduce((s, i) => s + i.cartaAmount, 0),
      },
      items,
    };
  }

  async summary(
    user: AuthUser,
    shopId: string,
    filters: SalesProductsFilters,
  ): Promise<SalesProductsSummary> {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    const tz = shop?.timezone ?? null;

    const byMenuItem = await this.loadLinkedMap(shopId);

    const from = filters.from;
    const to = filters.to;
    // Ventana amplia en UTC; el corte fino es por día de negocio (timezone del local).
    const rows = await this.orders
      .createQueryBuilder('o')
      .where('o.shopId = :shopId', { shopId })
      .andWhere('o.active = 1')
      .andWhere('o.status <> :cancelled', { cancelled: CustomerOrderStatus.CANCELLED })
      .andWhere(
        `(
          (o.completedAt IS NOT NULL AND o.completedAt >= :fromDt AND o.completedAt < :toDt)
          OR (o.completedAt IS NULL AND o.createdAt >= :fromDt AND o.createdAt < :toDt)
          OR (o.createdAt >= :fromWide AND o.createdAt < :toWide)
        )`,
        {
          fromDt: `${this.shiftDay(from, -1)}T00:00:00.000Z`,
          toDt: `${this.shiftDay(to, 2)}T00:00:00.000Z`,
          fromWide: `${this.shiftDay(from, -2)}T00:00:00.000Z`,
          toWide: `${this.shiftDay(to, 3)}T00:00:00.000Z`,
        },
      )
      .getMany();

    type Bucket = {
      productCode: string | null;
      productName: string | null;
      category: string | null;
      subcategory: string | null;
      menuItemId: string | null;
      qty: number;
      amount: number;
      ticketIds: Set<string>;
    };

    const productMap = new Map<AggKey, Bucket>();
    const dayMap = new Map<string, { qty: number; amount: number; ticketIds: Set<string> }>();
    const paymentMap = new Map<string, { qty: number; amount: number; ticketIds: Set<string> }>();
    const ticketAmounts = new Map<string, number>();

    const ensureProduct = (key: AggKey, seed: Omit<Bucket, 'qty' | 'amount' | 'ticketIds'>) => {
      let b = productMap.get(key);
      if (!b) {
        b = { ...seed, qty: 0, amount: 0, ticketIds: new Set() };
        productMap.set(key, b);
      }
      return b;
    };

    // Catálogo enlazado: aparece aunque no venda (si pasa filtros de rubro/texto).
    for (const [menuItemId, pos] of byMenuItem) {
      const category = pos.category ?? null;
      const subcategory = pos.subcategory ?? null;
      if (filters.category && (category || 'Sin rubro') !== filters.category) continue;
      if (filters.subcategory && (subcategory || 'Sin subrubro') !== filters.subcategory) {
        continue;
      }
      if (filters.q?.trim()) {
        const q = filters.q.trim().toLowerCase();
        const hay =
          `${pos.productCode ?? ''} ${pos.productName ?? ''} ${category ?? ''} ${menuItemId}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      ensureProduct(`linked:${menuItemId}`, {
        productCode: pos.productCode,
        productName: pos.productName,
        category,
        subcategory,
        menuItemId,
      });
    }

    for (const order of rows) {
      const when = order.completedAt ?? order.acceptedAt ?? order.createdAt;
      const businessDate = resolveShopCalendarDate(when instanceof Date ? when : new Date(when), {
        timezone: tz,
      });
      if (businessDate < from || businessDate > to) continue;

      const items = Array.isArray(order.items) ? order.items : [];
      let orderLineAmount = 0;
      let orderLineQty = 0;

      for (const raw of items) {
        const line = raw as CustomerOrderLine;
        const kind = line?.kind ?? 'ITEM';
        if (kind === 'PROMO') continue;
        const qty = n(line?.qty);
        const unit = n(line?.unitPrice);
        if (qty <= 0) continue;
        const amount = qty * unit;
        const menuItemId = String(line?.menuItemId ?? '').trim() || null;
        const linkedPos = menuItemId ? byMenuItem.get(menuItemId) : undefined;

        // Filtro por rubro / texto.
        const category = linkedPos?.category ?? null;
        const subcategory = linkedPos?.subcategory ?? null;
        const productName =
          linkedPos?.productName ?? (String(line?.name ?? '').trim() || null);
        const productCode = linkedPos?.productCode ?? null;

        if (filters.category && (category || 'Sin rubro') !== filters.category) continue;
        if (filters.subcategory && (subcategory || 'Sin subrubro') !== filters.subcategory) continue;
        if (filters.q?.trim()) {
          const q = filters.q.trim().toLowerCase();
          const hay = `${productCode ?? ''} ${productName ?? ''} ${category ?? ''} ${menuItemId ?? ''}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }

        const key = linkedPos
          ? `linked:${menuItemId}`
          : `carta:${menuItemId || productName || 'sin-id'}`;
        const bucket = ensureProduct(key, {
          productCode,
          productName,
          category,
          subcategory,
          menuItemId,
        });
        bucket.qty += qty;
        bucket.amount += amount;
        bucket.ticketIds.add(order.id);
        orderLineAmount += amount;
        orderLineQty += qty;
      }

      if (orderLineAmount <= 0 && orderLineQty <= 0) continue;

      const day = dayMap.get(businessDate) ?? {
        qty: 0,
        amount: 0,
        ticketIds: new Set<string>(),
      };
      day.qty += orderLineQty;
      day.amount += orderLineAmount;
      day.ticketIds.add(order.id);
      dayMap.set(businessDate, day);

      const payLabel =
        String(order.paymentMethodName ?? '').trim() ||
        String(order.paymentMethod ?? 'Sin pago');
      if (!filters.paymentCode || filters.paymentCode === payLabel) {
        const pay = paymentMap.get(payLabel) ?? {
          qty: 0,
          amount: 0,
          ticketIds: new Set<string>(),
        };
        pay.qty += orderLineQty;
        pay.amount += orderLineAmount;
        pay.ticketIds.add(order.id);
        paymentMap.set(payLabel, pay);
      }

      ticketAmounts.set(order.id, (ticketAmounts.get(order.id) ?? 0) + orderLineAmount);
    }

    // Traer ventas POS de platos enlazados (merge en vista, no persiste pedidos).
    if (filters.includePosSales) {
      const allowedIds =
        filters.posMenuItemIds && filters.posMenuItemIds.length
          ? new Set(filters.posMenuItemIds.map((id) => String(id).trim()).filter(Boolean))
          : null;
      const codeToMenu = new Map<string, string>();
      for (const [mid, pos] of byMenuItem) {
        if (allowedIds && !allowedIds.has(mid)) continue;
        codeToMenu.set(pos.productCode, mid);
      }
      const codes = [...codeToMenu.keys()];
      if (codes.length) {
        const posProductRaw = await this.posLines
          .createQueryBuilder('l')
          .innerJoin('l.ticket', 't')
          .where('t.shopId = :shopId', { shopId })
          .andWhere('t.active = 1')
          .andWhere('l.active = 1')
          .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
          .andWhere('l.productCode IN (:...codes)', { codes })
          .select('l.productCode', 'productCode')
          .addSelect('SUM(l.qty)', 'qty')
          .addSelect('SUM(l.amount)', 'amount')
          .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
          .groupBy('l.productCode')
          .getRawMany();

        for (const row of posProductRaw) {
          const code = String(row.productCode ?? '').trim();
          const menuItemId = codeToMenu.get(code);
          if (!menuItemId) continue;
          const pos = byMenuItem.get(menuItemId);
          if (!pos) continue;
          const category = pos.category ?? null;
          const subcategory = pos.subcategory ?? null;
          if (filters.category && (category || 'Sin rubro') !== filters.category) continue;
          if (filters.subcategory && (subcategory || 'Sin subrubro') !== filters.subcategory) {
            continue;
          }
          if (filters.q?.trim()) {
            const q = filters.q.trim().toLowerCase();
            const hay =
              `${pos.productCode ?? ''} ${pos.productName ?? ''} ${category ?? ''} ${menuItemId}`.toLowerCase();
            if (!hay.includes(q)) continue;
          }
          const bucket = ensureProduct(`linked:${menuItemId}`, {
            productCode: pos.productCode,
            productName: pos.productName,
            category,
            subcategory,
            menuItemId,
          });
          const qty = n(row.qty);
          const amount = n(row.amount);
          bucket.qty += qty;
          bucket.amount += amount;
          // Tickets POS: ids prefijados para no colisionar con customer_orders.
          const tc = Math.max(0, Math.floor(n(row.ticketCount)));
          for (let i = 0; i < tc; i++) {
            const tid = `pos:${code}:${i}`;
            bucket.ticketIds.add(tid);
            ticketAmounts.set(tid, (ticketAmounts.get(tid) ?? 0) + (tc > 0 ? amount / tc : 0));
          }
        }

        const posDayRaw = await this.posLines
          .createQueryBuilder('l')
          .innerJoin('l.ticket', 't')
          .where('t.shopId = :shopId', { shopId })
          .andWhere('t.active = 1')
          .andWhere('l.active = 1')
          .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
          .andWhere('l.productCode IN (:...codes)', { codes })
          .select('t.businessDate', 'date')
          .addSelect('l.productCode', 'productCode')
          .addSelect('SUM(l.qty)', 'qty')
          .addSelect('SUM(l.amount)', 'amount')
          .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
          .groupBy('t.businessDate')
          .addGroupBy('l.productCode')
          .getRawMany();

        for (const row of posDayRaw) {
          const code = String(row.productCode ?? '').trim();
          const menuItemId = codeToMenu.get(code);
          if (!menuItemId) continue;
          if (allowedIds && !allowedIds.has(menuItemId)) continue;
          const date = String(row.date ?? '').slice(0, 10);
          if (!date) continue;
          const day = dayMap.get(date) ?? {
            qty: 0,
            amount: 0,
            ticketIds: new Set<string>(),
          };
          day.qty += n(row.qty);
          day.amount += n(row.amount);
          const tc = Math.max(0, Math.floor(n(row.ticketCount)));
          for (let i = 0; i < tc; i++) {
            day.ticketIds.add(`pos-day:${date}:${code}:${i}`);
          }
          dayMap.set(date, day);
        }

        const posPayRaw = await this.posLines
          .createQueryBuilder('l')
          .innerJoin('l.ticket', 't')
          .where('t.shopId = :shopId', { shopId })
          .andWhere('t.active = 1')
          .andWhere('l.active = 1')
          .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
          .andWhere('l.productCode IN (:...codes)', { codes })
          .select("COALESCE(NULLIF(TRIM(t.paymentCode), ''), 'Sin pago')", 'paymentCode')
          .addSelect('SUM(l.qty)', 'qty')
          .addSelect('SUM(l.amount)', 'amount')
          .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
          .groupBy("COALESCE(NULLIF(TRIM(t.paymentCode), ''), 'Sin pago')")
          .getRawMany();

        for (const row of posPayRaw) {
          const payLabel = `POS · ${String(row.paymentCode ?? 'Sin pago')}`;
          if (filters.paymentCode && filters.paymentCode !== payLabel) continue;
          const pay = paymentMap.get(payLabel) ?? {
            qty: 0,
            amount: 0,
            ticketIds: new Set<string>(),
          };
          pay.qty += n(row.qty);
          pay.amount += n(row.amount);
          const tc = Math.max(0, Math.floor(n(row.ticketCount)));
          for (let i = 0; i < tc; i++) {
            pay.ticketIds.add(`pos-pay:${payLabel}:${i}`);
          }
          paymentMap.set(payLabel, pay);
        }
      }
    }

    // Si filtraron paymentCode, ya filtramos en el loop de payment; productos
    // pueden haber quedado de otros pagos — refiltrar no es trivial sin
    // re-agregar. Para simplicidad el filtro payment se aplica solo al desglose.

    const totalAmount = [...productMap.values()].reduce((s, b) => s + b.amount, 0);
    const totalQty = [...productMap.values()].reduce((s, b) => s + b.qty, 0);
    const ticketCount = ticketAmounts.size;
    const ticketVals = [...ticketAmounts.values()];
    const maxTicketAmount = ticketVals.length ? Math.max(...ticketVals) : 0;
    const minTicketAmount = ticketVals.length ? Math.min(...ticketVals) : 0;

    const products: SalesProductRow[] = [...productMap.values()]
      .map((b) => {
        const tc = b.ticketIds.size;
        return {
          productCode: b.productCode,
          productName: b.productName,
          category: b.category,
          subcategory: b.subcategory,
          qty: b.qty,
          amount: b.amount,
          ticketCount: tc,
          share: totalAmount > 0 ? b.amount / totalAmount : 0,
          avgTicketAmount: tc > 0 ? b.amount / tc : 0,
          ticketContribution: ticketCount > 0 ? b.amount / ticketCount : 0,
          trendPct: null,
          menuItemId: b.menuItemId,
          menuItemName: b.menuItemId ? b.productName : null,
        };
      })
      .sort((a, b) => b.amount - a.amount || b.qty - a.qty);

    const catMap = new Map<string, SalesCategoryRow>();
    for (const p of products) {
      if (p.qty <= 0 && p.amount <= 0 && !p.menuItemId) continue;
      const cat = p.category?.trim() || 'Sin rubro';
      const cur = catMap.get(cat) ?? {
        category: cat,
        productCount: 0,
        qty: 0,
        amount: 0,
        ticketCount: 0,
        share: 0,
      };
      cur.productCount += 1;
      cur.qty += p.qty;
      cur.amount += p.amount;
      catMap.set(cat, cur);
    }
    const categories = [...catMap.values()]
      .map((c) => ({
        ...c,
        share: totalAmount > 0 ? c.amount / totalAmount : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const subMap = new Map<string, SalesSubcategoryRow>();
    for (const p of products) {
      if (p.qty <= 0 && p.amount <= 0) continue;
      const category = p.category?.trim() || 'Sin rubro';
      const subcategory = p.subcategory?.trim() || 'Sin subrubro';
      const key = `${category}|${subcategory}`;
      const cur = subMap.get(key) ?? {
        category,
        subcategory,
        productCount: 0,
        qty: 0,
        amount: 0,
        ticketCount: 0,
        share: 0,
      };
      cur.productCount += 1;
      cur.qty += p.qty;
      cur.amount += p.amount;
      subMap.set(key, cur);
    }
    const subcategories = [...subMap.values()]
      .map((s) => ({
        ...s,
        share: totalAmount > 0 ? s.amount / totalAmount : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const byDay: SalesDayRow[] = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        qty: d.qty,
        amount: d.amount,
        ticketCount: d.ticketIds.size,
      }));

    const byPayment: SalesPaymentRow[] = [...paymentMap.entries()]
      .map(([paymentCode, d]) => ({
        paymentCode,
        qty: d.qty,
        amount: d.amount,
        ticketCount: d.ticketIds.size,
        share: totalAmount > 0 ? d.amount / totalAmount : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const top10 = products.slice(0, 10);
    const top10Share =
      totalAmount > 0 ? top10.reduce((s, p) => s + p.amount, 0) / totalAmount : 0;

    let cumulative = 0;
    const pareto = products.slice(0, 40).map((p) => {
      cumulative += p.amount;
      return {
        label: p.productName || p.productCode || '—',
        amount: p.amount,
        cumulativeShare: totalAmount > 0 ? cumulative / totalAmount : 0,
      };
    });

    const categoryByDay: Array<{ date: string; category: string; amount: number }> = [];

    return {
      shopId,
      from,
      to,
      totals: {
        qty: totalQty,
        amount: totalAmount,
        lineCount: products.reduce((s, p) => s + (p.qty > 0 ? 1 : 0), 0),
        productCount: products.filter((p) => p.qty > 0 || p.amount > 0 || !!p.menuItemId).length,
        categoryCount: categories.filter((c) => c.category !== 'Sin rubro').length,
        subcategoryCount: subcategories.filter((s) => s.subcategory !== 'Sin subrubro').length,
        ticketCount,
        avgTicketAmount: ticketCount > 0 ? totalAmount / ticketCount : 0,
        maxTicketAmount,
        minTicketAmount,
        dishesPerTicket: ticketCount > 0 ? totalQty / ticketCount : 0,
        top10Share,
        amountDeltaPct: null,
      },
      products,
      categories,
      subcategories,
      byDay,
      byPayment,
      pareto,
      categoryByDay,
      sameWeekdayCompare: [],
      filterOptions: {
        categories: [...new Set(products.map((p) => p.category?.trim() || 'Sin rubro'))].sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
        subcategories: [
          ...new Set(products.map((p) => p.subcategory?.trim() || 'Sin subrubro')),
        ].sort((a, b) => a.localeCompare(b, 'es')),
        paymentCodes: byPayment.map((p) => p.paymentCode),
      },
    };
  }

  private async loadLinkedMap(shopId: string): Promise<Map<string, LinkedPos>> {
    const linked = await this.products.find({
      where: { shopId, active: true },
      select: ['productCode', 'productName', 'category', 'subcategory', 'menuItemId'],
    });
    const byMenuItem = new Map<string, LinkedPos>();
    for (const p of linked) {
      const mid = String(p.menuItemId ?? '').trim();
      if (!mid) continue;
      byMenuItem.set(mid, {
        productCode: p.productCode,
        productName: p.productName ?? null,
        category: p.category ?? null,
        subcategory: p.subcategory ?? null,
      });
    }
    return byMenuItem;
  }

  private menuNameMap(menu: unknown): Map<string, string> {
    const out = new Map<string, string>();
    const root = menu as {
      menus?: Array<{ sections?: Array<{ items?: Array<{ id?: string; name?: string }> }> }>;
      sections?: Array<{ items?: Array<{ id?: string; name?: string }> }>;
    } | null;
    if (!root) return out;
    const pushItems = (
      sections?: Array<{ items?: Array<{ id?: string; name?: string }> }>,
    ) => {
      for (const sec of sections ?? []) {
        for (const it of sec?.items ?? []) {
          const id = String(it?.id ?? '').trim();
          const name = String(it?.name ?? '').trim();
          if (id && name) out.set(id, name);
        }
      }
    };
    if (Array.isArray(root.menus)) {
      for (const m of root.menus) pushItems(m.sections);
    } else {
      pushItems(root.sections);
    }
    return out;
  }

  private async aggregatePosByCode(
    shopId: string,
    from: string,
    to: string,
    codes: string[],
  ): Promise<Map<string, { qty: number; amount: number; ticketCount: number }>> {
    const out = new Map<string, { qty: number; amount: number; ticketCount: number }>();
    if (!codes.length) return out;
    const raw = await this.posLines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
      .andWhere('l.productCode IN (:...codes)', { codes })
      .select('l.productCode', 'productCode')
      .addSelect('SUM(l.qty)', 'qty')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('COUNT(DISTINCT t.id)', 'ticketCount')
      .groupBy('l.productCode')
      .getRawMany();
    for (const row of raw) {
      const code = String(row.productCode ?? '').trim();
      if (!code) continue;
      out.set(code, {
        qty: n(row.qty),
        amount: n(row.amount),
        ticketCount: n(row.ticketCount),
      });
    }
    return out;
  }

  private shiftDay(iso: string, delta: number): string {
    const d = new Date(`${iso}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
