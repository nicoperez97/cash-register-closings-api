import {
  isOrderingChannelOpenNow,
  normalizeOrderingHoursByWeekday,
  type OrderingHoursByWeekday,
} from './shop-ordering';

/** @deprecated Prefer poolItemIds + packQty. Kept for legacy payloads. */
export type ShopPromoItem = {
  menuItemId: string;
  qty: number;
};

export type ShopPromo = {
  id: string;
  name: string;
  description?: string | null;
  available: boolean;
  fixedPrice: number;
  /** Ítems elegibles (mín. 1). */
  poolItemIds: string[];
  /** Unidades del pool que forman 1 pack (mín. 1). */
  packQty: number;
  /** Canal comanda: vender en comanda + matching de mesa. */
  forComanda: boolean;
  /** Canal pedidos: staff /pedir y (si se publica) página pública. */
  forPedidos: boolean;
  /** Si forPedidos: aparece en la sección Promos de /pedir público. */
  showOnPublicOrdering: boolean;
  /** Matching automático en ticket de mesa (comanda). */
  tableMatchable: boolean;
  /** Informativo en carta /m. */
  showOnPublicMenu: boolean;
  /**
   * Alias de lectura: vender pack en comanda (= forComanda).
   * Se mantiene para callers legacy.
   */
  sellable: boolean;
  /**
   * Alias de lectura derivado del pool (cada ítem qty 1) para UI legacy.
   * El matching usa poolItemIds + packQty.
   */
  items: ShopPromoItem[];
  /** @deprecated Eventos sin pool ya no se aceptan. */
  specialName?: string | null;
  /** Ventanas por día de semana; null/vacío = sin límite semanal. */
  schedule?: OrderingHoursByWeekday | null;
  /** Fechas puntuales YYYY-MM-DD (modo “solo hoy” / fechas). */
  validDates?: string[] | null;
};

export type PromoSelectionLine = { menuItemId: string; qty: number };

/** Promo asignada a una mesa (cupo null = ilimitado). */
export type SessionPromoAssignment = {
  promoId: string;
  maxCount: number | null;
};

function newPromoId(): string {
  return `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePromoValidDates(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, 60)) {
    const d = String(row ?? '').trim().slice(0, 10);
    if (!DATE_RE.test(d) || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.length ? out : null;
}

/** Fecha local YYYY-MM-DD en la zona del local. */
export function localDateKey(now: Date, timezone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const d = parts.find((p) => p.type === 'day')?.value ?? '';
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizePoolAndPackQty(r: Record<string, unknown>): {
  poolItemIds: string[];
  packQty: number;
} | null {
  const poolItemIds: string[] = [];
  const seen = new Set<string>();
  const rawPool = r.poolItemIds;
  if (Array.isArray(rawPool)) {
    for (const row of rawPool.slice(0, 40)) {
      const id = String(row ?? '').trim().slice(0, 40);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      poolItemIds.push(id);
    }
  }

  let packQty = Math.round(Number(r.packQty));
  if (!Number.isFinite(packQty) || packQty < 1) packQty = 0;

  // Legacy items: [{ menuItemId, qty }] → pool + suma de qtys.
  const legacyItems = Array.isArray(r.items) ? r.items : [];
  if (!poolItemIds.length && legacyItems.length) {
    let sumQty = 0;
    for (const it of legacyItems.slice(0, 40)) {
      if (!it || typeof it !== 'object') continue;
      const menuItemId = String((it as ShopPromoItem).menuItemId ?? '')
        .trim()
        .slice(0, 40);
      if (!menuItemId) continue;
      const qty = Math.round(Number((it as ShopPromoItem).qty));
      if (!Number.isFinite(qty) || qty < 1) continue;
      sumQty += Math.min(99, qty);
      if (!seen.has(menuItemId)) {
        seen.add(menuItemId);
        poolItemIds.push(menuItemId);
      }
    }
    if (!packQty && sumQty > 0) packQty = Math.min(99, sumQty);
  }

  if (!poolItemIds.length) return null;
  if (!packQty) packQty = 1;
  packQty = Math.min(99, Math.max(1, packQty));
  return { poolItemIds, packQty };
}

export function normalizeShopPromos(raw: unknown): ShopPromo[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: ShopPromo[] = [];
  for (const row of raw.slice(0, 80)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? '').trim().slice(0, 120);
    if (!name) continue;
    let id = String(r.id ?? '').trim().slice(0, 40);
    if (!id || used.has(id)) id = newPromoId();
    used.add(id);

    const pool = normalizePoolAndPackQty(r);
    if (!pool) continue;

    let fixedPrice = Number(r.fixedPrice);
    if (!Number.isFinite(fixedPrice) || fixedPrice < 0) fixedPrice = 0;
    fixedPrice = Math.round(fixedPrice * 100) / 100;

    const hasForComanda = r.forComanda !== undefined;
    const hasSellable = r.sellable !== undefined;
    const hasTable = r.tableMatchable !== undefined;
    const tableMatchable = hasTable ? r.tableMatchable !== false : true;
    const forComanda = hasForComanda
      ? r.forComanda !== false
      : hasSellable
        ? r.sellable !== false || tableMatchable
        : true;
    const forPedidos = r.forPedidos === true;
    const showOnPublicOrdering = forPedidos && r.showOnPublicOrdering === true;

    const items: ShopPromoItem[] = pool.poolItemIds.map((menuItemId) => ({
      menuItemId,
      qty: 1,
    }));

    out.push({
      id,
      name,
      description: String(r.description ?? '').trim().slice(0, 400) || null,
      available: r.available !== false,
      fixedPrice,
      poolItemIds: pool.poolItemIds,
      packQty: pool.packQty,
      forComanda,
      forPedidos,
      showOnPublicOrdering,
      tableMatchable: forComanda && tableMatchable,
      showOnPublicMenu: !!r.showOnPublicMenu,
      sellable: forComanda,
      items,
      specialName: null,
      schedule: normalizeOrderingHoursByWeekday(r.schedule ?? null),
      validDates: normalizePromoValidDates(r.validDates ?? null),
    });
  }
  return out;
}

/** Valida selections de un pack (o N packs): ⊆ pool y suma === packQty * packs. */
export function normalizePromoSelections(
  promo: ShopPromo,
  packsRaw: number,
  selectionsRaw: unknown,
): PromoSelectionLine[] | null {
  const packs = Math.max(1, Math.min(99, Math.round(Number(packsRaw) || 1)));
  const need = packs * Math.max(1, promo.packQty);
  const pool = new Set(promo.poolItemIds);
  if (!pool.size) return null;
  if (!Array.isArray(selectionsRaw)) return null;
  const byId = new Map<string, number>();
  for (const row of selectionsRaw.slice(0, 40)) {
    if (!row || typeof row !== 'object') continue;
    const menuItemId = String((row as PromoSelectionLine).menuItemId ?? '')
      .trim()
      .slice(0, 40);
    if (!menuItemId || !pool.has(menuItemId)) return null;
    const qty = Math.round(Number((row as PromoSelectionLine).qty));
    if (!Number.isFinite(qty) || qty < 1) return null;
    byId.set(menuItemId, (byId.get(menuItemId) ?? 0) + Math.min(99, qty));
  }
  const selections = [...byId.entries()].map(([menuItemId, qty]) => ({
    menuItemId,
    qty: Math.min(99, qty),
  }));
  const sum = selections.reduce((s, x) => s + x.qty, 0);
  if (sum !== need) return null;
  return selections;
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
  const dates = promo.validDates?.filter(Boolean) ?? [];
  const hasSchedule = !!(promo.schedule && Object.keys(promo.schedule).length);

  if (dates.length) {
    const today = localDateKey(now, timezone);
    if (!dates.includes(today)) return false;
    // Fechas puntuales + schedule → respetar ventana horaria del día.
    if (hasSchedule) return isOrderingChannelOpenNow(promo.schedule, now, timezone);
    return true; // todo el día
  }

  if (!hasSchedule) return true;
  return isOrderingChannelOpenNow(promo.schedule, now, timezone);
}

/** Tiene vigencia acotada (días / fechas) → candidata a autoasignar al abrir mesa. */
export function promoHasTimeRestriction(promo: ShopPromo): boolean {
  if (promo.validDates?.length) return true;
  return !!(promo.schedule && Object.keys(promo.schedule).length);
}

/** Promos de mesa vigentes ahora, para autoasignar al abrir. */
export function autoAssignPromosAtOpen(
  promos: ShopPromo[],
  now = new Date(),
  timezone?: string,
): ShopPromo[] {
  return promos.filter(
    (p) =>
      p.available &&
      p.forComanda &&
      p.tableMatchable &&
      promoHasTimeRestriction(p) &&
      isPromoInSchedule(p, now, timezone),
  );
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
  const poolIds = (promo.poolItemIds ?? []).filter(Boolean);
  const packQty = Math.max(1, Math.round(Number(promo.packQty) || 1));
  if (!poolIds.length) return null;

  let have = 0;
  for (const id of poolIds) {
    have += remainingByItem.get(id)?.qty ?? 0;
  }
  let packs = Math.floor(have / packQty);
  const max =
    promoMaxCount == null || !Number.isFinite(Number(promoMaxCount))
      ? null
      : Math.max(0, Math.floor(Number(promoMaxCount)));
  if (max != null) packs = Math.min(packs, max);
  if (packs <= 0) return null;

  let toConsume = packs * packQty;
  const ordered = [...poolIds].sort((a, b) => a.localeCompare(b));
  for (const id of ordered) {
    if (toConsume <= 0) break;
    const cur = remainingByItem.get(id);
    if (!cur || cur.qty <= 0) continue;
    const take = Math.min(cur.qty, toConsume);
    cur.qty = Math.max(0, cur.qty - take);
    toConsume -= take;
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
  _opts?: { now?: Date; timezone?: string },
): PromoBreakdown | null {
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
    if (!promo?.available || !promo.forComanda || !promo.tableMatchable) continue;
    if (!promo.poolItemIds?.length) continue;
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
