import {
  isOrderingChannelOpenNow,
  normalizeOrderingHoursByWeekday,
  type OrderingHoursByWeekday,
} from './shop-ordering';

export type ShopPromoItem = {
  menuItemId: string;
  qty: number;
};

export type ShopPromo = {
  id: string;
  name: string;
  description?: string | null;
  available: boolean;
  showOnPublicMenu: boolean;
  sellable: boolean;
  tableMatchable: boolean;
  fixedPrice: number;
  /** 1 pack = estos ítems de carta (vacío = ítem especial de evento). */
  items: ShopPromoItem[];
  /** Si no hay composición: nombre de la línea de cocina. */
  specialName?: string | null;
  /** Ventanas por día; null = siempre. */
  schedule?: OrderingHoursByWeekday | null;
};

/** Promo asignada a una mesa (cupo null = ilimitado). */
export type SessionPromoAssignment = {
  promoId: string;
  maxCount: number | null;
};

function newPromoId(): string {
  return `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeShopPromos(raw: unknown): ShopPromo[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: ShopPromo[] = [];
  for (const row of raw.slice(0, 80)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<ShopPromo>;
    const name = String(r.name ?? '').trim().slice(0, 120);
    if (!name) continue;
    let id = String(r.id ?? '').trim().slice(0, 40);
    if (!id || used.has(id)) id = newPromoId();
    used.add(id);
    const items: ShopPromoItem[] = [];
    const seenItems = new Set<string>();
    if (Array.isArray(r.items)) {
      for (const it of r.items.slice(0, 40)) {
        if (!it || typeof it !== 'object') continue;
        const menuItemId = String((it as ShopPromoItem).menuItemId ?? '').trim().slice(0, 40);
        if (!menuItemId || seenItems.has(menuItemId)) continue;
        const qty = Math.round(Number((it as ShopPromoItem).qty));
        if (!Number.isFinite(qty) || qty < 1) continue;
        seenItems.add(menuItemId);
        items.push({ menuItemId, qty: Math.min(99, qty) });
      }
    }
    const specialName = String(r.specialName ?? '').trim().slice(0, 120) || null;
    if (!items.length && !specialName) continue;
    let fixedPrice = Number(r.fixedPrice);
    if (!Number.isFinite(fixedPrice) || fixedPrice < 0) fixedPrice = 0;
    fixedPrice = Math.round(fixedPrice * 100) / 100;
    out.push({
      id,
      name,
      description: String(r.description ?? '').trim().slice(0, 400) || null,
      available: r.available !== false,
      showOnPublicMenu: !!r.showOnPublicMenu,
      sellable: r.sellable !== false,
      tableMatchable: r.tableMatchable !== false,
      fixedPrice,
      items,
      specialName: items.length ? null : specialName,
      schedule: normalizeOrderingHoursByWeekday(r.schedule ?? null),
    });
  }
  return out;
}

/** Lee sessionPromos JSON o migra desde promoId/promoMaxCount legacy. */
export function normalizeSessionPromos(
  raw: unknown,
  legacy?: { promoId?: string | null; promoMaxCount?: number | null },
): SessionPromoAssignment[] {
  const out: SessionPromoAssignment[] = [];
  const seen = new Set<string>();
  const push = (promoIdRaw: unknown, maxRaw: unknown) => {
    const promoId = String(promoIdRaw ?? '').trim().slice(0, 40);
    if (!promoId || seen.has(promoId)) return;
    seen.add(promoId);
    let maxCount: number | null = null;
    if (maxRaw != null && maxRaw !== '') {
      const n = Math.round(Number(maxRaw));
      if (Number.isFinite(n) && n >= 0) maxCount = Math.min(999, Math.max(0, n));
    }
    out.push({ promoId, maxCount });
  };
  if (Array.isArray(raw)) {
    for (const row of raw.slice(0, 20)) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Partial<SessionPromoAssignment> & { promoMaxCount?: number | null };
      push(r.promoId, r.maxCount !== undefined ? r.maxCount : r.promoMaxCount);
    }
  }
  if (!out.length && legacy?.promoId) {
    push(legacy.promoId, legacy.promoMaxCount);
  }
  return out;
}

export function isPromoInSchedule(
  promo: ShopPromo,
  now = new Date(),
  timezone?: string,
): boolean {
  if (!promo.schedule || !Object.keys(promo.schedule).length) return true;
  return isOrderingChannelOpenNow(promo.schedule, now, timezone);
}

export type PromoMatchLine = {
  menuItemId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  kind?: string | null;
  promoId?: string | null;
  notes?: string | null;
  extraId?: string | null;
  attachedToMenuItemId?: string | null;
};

export type PromoBreakdownApplied = {
  promoId: string;
  promoName: string;
  packs: number;
  packPrice: number;
  packsTotal: number;
};

export type PromoBreakdown = {
  promoId: string;
  promoName: string;
  packs: number;
  packPrice: number;
  packsTotal: number;
  /** Packs por promo (multi-promo). */
  applied: PromoBreakdownApplied[];
  /** Líneas remanente (fuera de pack) + extras + ventas PROMO ya cobradas. */
  outside: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    kind: string;
  }>;
  outsideTotal: number;
  soldPromoTotal: number;
  /** Total antes de descuento manual de ticket. */
  baseTotal: number;
};

function money2(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100);
}

type RemainingItem = { qty: number; unitPrice: number; name: string };

function buildRemainingPool(matchable: PromoMatchLine[]): Map<string, RemainingItem> {
  const remainingByItem = new Map<string, RemainingItem>();
  for (const l of matchable) {
    const id = String(l.menuItemId ?? '').trim();
    if (!id) continue;
    const qty = Math.max(0, Number(l.qty) || 0);
    if (!qty) continue;
    const prev = remainingByItem.get(id);
    if (prev) {
      const totalQty = prev.qty + qty;
      const avg =
        totalQty > 0
          ? (prev.unitPrice * prev.qty + (Number(l.unitPrice) || 0) * qty) / totalQty
          : prev.unitPrice;
      remainingByItem.set(id, {
        qty: totalQty,
        unitPrice: avg,
        name: prev.name || l.name,
      });
    } else {
      remainingByItem.set(id, {
        qty,
        unitPrice: Number(l.unitPrice) || 0,
        name: l.name,
      });
    }
  }
  return remainingByItem;
}

function applyOnePromoToPool(
  remainingByItem: Map<string, RemainingItem>,
  promo: ShopPromo,
  promoMaxCount: number | null | undefined,
): PromoBreakdownApplied | null {
  const req = promo.items ?? [];
  if (!req.length) return null;
  let possible = Infinity;
  for (const r of req) {
    const have = remainingByItem.get(r.menuItemId)?.qty ?? 0;
    possible = Math.min(possible, Math.floor(have / r.qty));
  }
  let packs = Number.isFinite(possible) ? Math.max(0, possible) : 0;
  const max =
    promoMaxCount == null || !Number.isFinite(Number(promoMaxCount))
      ? null
      : Math.max(0, Math.floor(Number(promoMaxCount)));
  if (max != null) packs = Math.min(packs, max);
  if (packs <= 0) return null;
  for (const r of req) {
    const cur = remainingByItem.get(r.menuItemId);
    if (!cur) continue;
    cur.qty = Math.max(0, cur.qty - packs * r.qty);
  }
  const packPrice = money2(promo.fixedPrice);
  return {
    promoId: promo.id,
    promoName: promo.name,
    packs,
    packPrice,
    packsTotal: money2(packs * packPrice),
  };
}

function finishBreakdown(
  remainingByItem: Map<string, RemainingItem>,
  extrasAndMisc: PromoMatchLine[],
  applied: PromoBreakdownApplied[],
  soldPromoTotal: number,
): PromoBreakdown {
  const outside: PromoBreakdown['outside'] = [];
  for (const [, cur] of remainingByItem) {
    if (cur.qty <= 0) continue;
    outside.push({
      name: cur.name,
      qty: cur.qty,
      unitPrice: money2(cur.unitPrice),
      amount: money2(cur.unitPrice * cur.qty),
      kind: 'ITEM',
    });
  }
  for (const l of extrasAndMisc) {
    const qty = Math.max(0, Number(l.qty) || 0);
    if (!qty) continue;
    const unitPrice = Number(l.unitPrice) || 0;
    outside.push({
      name: l.name,
      qty,
      unitPrice: money2(unitPrice),
      amount: money2(unitPrice * qty),
      kind: l.kind || 'EXTRA',
    });
  }
  const outsideTotal = money2(outside.reduce((s, o) => s + o.amount, 0));
  const packsTotal = money2(applied.reduce((s, a) => s + a.packsTotal, 0));
  const packs = applied.reduce((s, a) => s + a.packs, 0);
  const first = applied[0];
  const baseTotal = money2(packsTotal + outsideTotal + soldPromoTotal);
  return {
    promoId: first?.promoId ?? '',
    promoName:
      applied.length <= 1
        ? first?.promoName ?? ''
        : applied.map((a) => `${a.packs}× ${a.promoName}`).join(' · '),
    packs,
    packPrice: first?.packPrice ?? 0,
    packsTotal,
    applied,
    outside,
    outsideTotal,
    soldPromoTotal,
    baseTotal,
  };
}

/**
 * Matching de packs sobre líneas de mesa.
 * - Ítems con promoId (hijos legacy de venta) no cuentan para matching.
 * - Líneas PROMO ya vendidas suman su unitPrice×qty.
 * - Extras suman a precio de línea.
 */
export function computePromoBreakdown(
  lines: PromoMatchLine[],
  promo: ShopPromo | null | undefined,
  promoMaxCount: number | null | undefined,
  opts?: { now?: Date; timezone?: string },
): PromoBreakdown | null {
  if (!promo) return null;
  return computeMultiPromoBreakdown(
    lines,
    [{ promo, maxCount: promoMaxCount ?? null }],
    opts,
  );
}

export function computeMultiPromoBreakdown(
  lines: PromoMatchLine[],
  assignments: Array<{ promo: ShopPromo; maxCount: number | null }>,
  opts?: { now?: Date; timezone?: string },
): PromoBreakdown | null {
  const now = opts?.now ?? new Date();
  const timezone = opts?.timezone;

  const soldPromoTotal = money2(
    lines
      .filter((l) => (l.kind || 'ITEM') === 'PROMO')
      .reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0), 0),
  );

  const extrasAndMisc = lines.filter((l) => {
    const kind = l.kind || 'ITEM';
    return kind === 'EXTRA' || (kind !== 'ITEM' && kind !== 'PROMO');
  });

  const matchable = lines.filter((l) => {
    const kind = l.kind || 'ITEM';
    if (kind !== 'ITEM') return false;
    if (l.promoId) return false;
    return true;
  });

  const remainingByItem = buildRemainingPool(matchable);
  const applied: PromoBreakdownApplied[] = [];

  for (const a of assignments) {
    const promo = a.promo;
    if (!promo?.available || !promo.tableMatchable) continue;
    if (!isPromoInSchedule(promo, now, timezone)) continue;
    if (!promo.items?.length) continue;
    const hit = applyOnePromoToPool(remainingByItem, promo, a.maxCount);
    if (hit) applied.push(hit);
  }

  if (!applied.length && !soldPromoTotal) {
    // Sin packs ni ventas PROMO: no hay breakdown de promo (subtotal = suma órdenes).
    return null;
  }

  return finishBreakdown(remainingByItem, extrasAndMisc, applied, soldPromoTotal);
}

/** Total de sesión sin promo = suma de order.total; con promo = breakdown.baseTotal. */
export function sessionBaseTotalFromOrders(
  orderTotals: number[],
  breakdown: PromoBreakdown | null,
): number {
  if (breakdown) return breakdown.baseTotal;
  return money2(orderTotals.reduce((s, t) => s + (Number(t) || 0), 0));
}
