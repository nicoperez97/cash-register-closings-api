/** Modo operativo del local: al paso (take away/delivery) vs restaurante (mesas en /pedir y/o mozo). */
export enum ShopMode {
  AL_PASO = 'AL_PASO',
  RESTAURANTE = 'RESTAURANTE',
}

export type OrderingTimeWindow = { open: string; close: string };

/**
 * Ventanas del día (puede haber más de una) o null = cerrado.
 * Legacy: un solo `{ open, close }` se normaliza a `[{ open, close }]`.
 */
export type OrderingDayWindows = OrderingTimeWindow[] | null;

/** "0"…"6" → ventanas HH:mm o null = cerrado ese día. */
export type OrderingHoursByWeekday = Record<string, OrderingDayWindows>;

export type ShopOrderingHours = {
  takeaway?: OrderingHoursByWeekday | null;
  delivery?: OrderingHoursByWeekday | null;
};

export type OrderingPaymentMethod = 'CASH' | 'TRANSFER';

/** Medio de pago del pedido online: nombre libre + cuenta opcional (igual que mesa). */
export type OrderingPaymentMethodItem = {
  id: string;
  name: string;
  accountId?: string | null;
  active?: boolean;
};

export type ShopOrderingPayments = {
  /** Derivado de `items` activos (compat checkout / legacy). */
  methods?: OrderingPaymentMethod[];
  /** Lista editable (nombre + cuenta), igual que medios de mesa. */
  items?: OrderingPaymentMethodItem[];
  transferInstructions?: string | null;
  /** WhatsApp para comprobantes de transferencia. Si vacío, se usa el teléfono del local. */
  whatsapp?: string | null;
};

/** Medio de pago de mesa (comanda): nombre libre + cuenta opcional del local. */
export type TablePaymentMethod = {
  id: string;
  name: string;
  accountId?: string | null;
  active?: boolean;
};

function newTablePayId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function newOrderingPayId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Clasifica un medio por id/nombre para cierre / enum de pedidos. */
export function classifyPaymentMethodKind(
  id: string,
  name: string,
): 'CASH' | 'TRANSFER' | 'CARD' {
  const key = `${id} ${name}`.toLowerCase();
  if (/transf|transfer|alias|cbu|cvu|mercado\s*pago|mp\b/.test(key)) return 'TRANSFER';
  if (/tarjeta|card|d[eé]bito|cr[eé]dito|posnet|visa|master|amex|\bpvs\b/.test(key)) {
    return 'CARD';
  }
  if (/efectivo|cash|contado|tp_cash|op_cash/.test(key)) return 'CASH';
  return 'CASH';
}

function defaultOrderingPayItems(): OrderingPaymentMethodItem[] {
  return [
    { id: 'op_cash', name: 'Efectivo', accountId: null, active: true },
    { id: 'op_transfer', name: 'Transferencia', accountId: null, active: true },
  ];
}

function normalizeOrderingPayItems(raw: unknown): OrderingPaymentMethodItem[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: OrderingPaymentMethodItem[] = [];
  for (const row of raw.slice(0, 30)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as OrderingPaymentMethodItem;
    const name = String(r.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    let id = String(r.id ?? '').trim().slice(0, 40);
    if (!id || used.has(id)) id = newOrderingPayId();
    used.add(id);
    const accountId = String(r.accountId ?? '').trim().slice(0, 36) || null;
    out.push({
      id,
      name,
      accountId,
      active: r.active !== false,
    });
  }
  return out;
}

function orderingItemsFromLegacyMethods(
  methods: OrderingPaymentMethod[],
): OrderingPaymentMethodItem[] {
  const wantCash = !methods.length || methods.includes('CASH');
  const wantTransfer = !methods.length || methods.includes('TRANSFER');
  return [
    { id: 'op_cash', name: 'Efectivo', accountId: null, active: wantCash },
    { id: 'op_transfer', name: 'Transferencia', accountId: null, active: wantTransfer },
  ];
}

function deriveOrderingMethods(
  items: OrderingPaymentMethodItem[],
): OrderingPaymentMethod[] {
  const set = new Set<OrderingPaymentMethod>();
  for (const item of items) {
    if (item.active === false) continue;
    const kind = classifyPaymentMethodKind(item.id, item.name);
    set.add(kind === 'TRANSFER' ? 'TRANSFER' : 'CASH');
  }
  if (!set.size) return ['CASH', 'TRANSFER'];
  return [...set];
}

/** Activa/desactiva items según methods legacy (panel rápido Pedidos clientes). */
export function syncOrderingPayItemsFromMethods(
  items: OrderingPaymentMethodItem[],
  methods: OrderingPaymentMethod[],
): OrderingPaymentMethodItem[] {
  const wantCash = methods.includes('CASH');
  const wantTransfer = methods.includes('TRANSFER');
  let hasCash = false;
  let hasTransfer = false;
  const out = (items.length ? items : defaultOrderingPayItems()).map((it) => {
    const kind = classifyPaymentMethodKind(it.id, it.name);
    if (kind === 'TRANSFER') {
      hasTransfer = true;
      return { ...it, active: wantTransfer };
    }
    hasCash = true;
    return { ...it, active: wantCash };
  });
  if (wantCash && !hasCash) {
    out.push({ id: 'op_cash', name: 'Efectivo', accountId: null, active: true });
  }
  if (wantTransfer && !hasTransfer) {
    out.push({ id: 'op_transfer', name: 'Transferencia', accountId: null, active: true });
  }
  return out;
}

export function normalizeTablePaymentMethods(raw: unknown): TablePaymentMethod[] {
  if (!Array.isArray(raw)) {
    return [
      { id: 'tp_cash', name: 'Efectivo', accountId: null, active: true },
      { id: 'tp_card', name: 'Tarjeta', accountId: null, active: true },
      { id: 'tp_transfer', name: 'Transferencia', accountId: null, active: true },
    ];
  }
  const used = new Set<string>();
  const out: TablePaymentMethod[] = [];
  for (const row of raw.slice(0, 30)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as TablePaymentMethod;
    const name = String(r.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    let id = String(r.id ?? '').trim().slice(0, 40);
    if (!id || used.has(id)) id = newTablePayId();
    used.add(id);
    const accountId = String(r.accountId ?? '').trim().slice(0, 36) || null;
    out.push({
      id,
      name,
      accountId,
      active: r.active !== false,
    });
  }
  if (!out.length) {
    return [
      { id: 'tp_cash', name: 'Efectivo', accountId: null, active: true },
      { id: 'tp_card', name: 'Tarjeta', accountId: null, active: true },
      { id: 'tp_transfer', name: 'Transferencia', accountId: null, active: true },
    ];
  }
  return out;
}

/** Capacidades de la comanda (emitir / modificar / borrar), por canal. */
export type WaiterCapProfile = {
  allowSendOrder: boolean;
  allowPrintKitchen: boolean;
  defaultPrintKitchen: boolean;
  lockPrintKitchen: boolean;
  allowPrintCustomerTicket: boolean;
  defaultPrintCustomerTicket: boolean;
  lockPrintCustomerTicket: boolean;
  allowEditTicket: boolean;
  allowRemoveTicketLines: boolean;
  allowTicketDiscount: boolean;
  allowCloseTable: boolean;
  requireTicketBeforeClose: boolean;
  allowTipOnClose: boolean;
  allowDiscardEmptySession: boolean;
  allowHistory: boolean;
  /** Solo aplica en staff (Operación → Comanda). */
  requireWaiterOnOpen: boolean;
};

export type WaiterCapabilities = {
  public: WaiterCapProfile;
  staff: WaiterCapProfile;
};

export const DEFAULT_WAITER_CAP_PUBLIC: WaiterCapProfile = {
  allowSendOrder: true,
  allowPrintKitchen: true,
  defaultPrintKitchen: true,
  lockPrintKitchen: false,
  allowPrintCustomerTicket: true,
  defaultPrintCustomerTicket: false,
  lockPrintCustomerTicket: false,
  allowEditTicket: true,
  allowRemoveTicketLines: true,
  allowTicketDiscount: true,
  allowCloseTable: true,
  requireTicketBeforeClose: true,
  allowTipOnClose: true,
  allowDiscardEmptySession: true,
  allowHistory: true,
  requireWaiterOnOpen: false,
};

export const DEFAULT_WAITER_CAP_STAFF: WaiterCapProfile = {
  ...DEFAULT_WAITER_CAP_PUBLIC,
  requireWaiterOnOpen: true,
};

function boolOr(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  return fallback;
}

export function normalizeWaiterCapProfile(
  raw: unknown,
  fallback: WaiterCapProfile,
): WaiterCapProfile {
  const r =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const allowPrintKitchen = boolOr(r.allowPrintKitchen, fallback.allowPrintKitchen);
  const allowPrintCustomerTicket = boolOr(
    r.allowPrintCustomerTicket,
    fallback.allowPrintCustomerTicket,
  );
  return {
    allowSendOrder: boolOr(r.allowSendOrder, fallback.allowSendOrder),
    allowPrintKitchen,
    defaultPrintKitchen: allowPrintKitchen
      ? boolOr(r.defaultPrintKitchen, fallback.defaultPrintKitchen)
      : false,
    lockPrintKitchen: allowPrintKitchen
      ? boolOr(r.lockPrintKitchen, fallback.lockPrintKitchen)
      : false,
    allowPrintCustomerTicket,
    defaultPrintCustomerTicket: allowPrintCustomerTicket
      ? boolOr(r.defaultPrintCustomerTicket, fallback.defaultPrintCustomerTicket)
      : false,
    lockPrintCustomerTicket: allowPrintCustomerTicket
      ? boolOr(r.lockPrintCustomerTicket, fallback.lockPrintCustomerTicket)
      : false,
    allowEditTicket: boolOr(r.allowEditTicket, fallback.allowEditTicket),
    allowRemoveTicketLines: boolOr(
      r.allowRemoveTicketLines,
      fallback.allowRemoveTicketLines,
    ),
    allowTicketDiscount: boolOr(r.allowTicketDiscount, fallback.allowTicketDiscount),
    allowCloseTable: boolOr(r.allowCloseTable, fallback.allowCloseTable),
    requireTicketBeforeClose: boolOr(
      r.requireTicketBeforeClose,
      fallback.requireTicketBeforeClose,
    ),
    allowTipOnClose: boolOr(r.allowTipOnClose, fallback.allowTipOnClose),
    allowDiscardEmptySession: boolOr(
      r.allowDiscardEmptySession,
      fallback.allowDiscardEmptySession,
    ),
    allowHistory: boolOr(r.allowHistory, fallback.allowHistory),
    requireWaiterOnOpen: boolOr(r.requireWaiterOnOpen, fallback.requireWaiterOnOpen),
  };
}

export function normalizeWaiterCapabilities(raw: unknown): WaiterCapabilities {
  const r =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    public: normalizeWaiterCapProfile(r.public, DEFAULT_WAITER_CAP_PUBLIC),
    staff: normalizeWaiterCapProfile(r.staff, DEFAULT_WAITER_CAP_STAFF),
  };
}

export function resolveWaiterCapProfile(
  caps: WaiterCapabilities | null | undefined,
  typ: string | undefined,
): WaiterCapProfile {
  const all = normalizeWaiterCapabilities(caps);
  return typ === 'waiter_staff' ? all.staff : all.public;
}

export type DeliveryZonePoint = { lat: number; lng: number };

export type DeliveryZone = {
  id: string;
  name: string;
  fee: number;
  note?: string | null;
  /** Polígono del área (mín. 3 puntos). Si falta, la zona solo se elige a mano. */
  polygon?: DeliveryZonePoint[] | null;
  /** Color del polígono en el mapa (#RRGGBB). */
  color?: string | null;
};

export type ShopOrderingEta = {
  takeaway?: string | null;
  delivery?: string | null;
};

/** Extra opcional del pedido online (adherido a ítems de la carta). */
export type OrderingExtra = {
  id: string;
  name: string;
  price: number;
  available?: boolean;
  /** Ítems de carta a los que aplica; vacío = todos. */
  menuItemIds?: string[];
};

function newExtraId(): string {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeOrderingExtras(raw: unknown): OrderingExtra[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: OrderingExtra[] = [];
  for (const row of raw.slice(0, 80)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as OrderingExtra;
    const name = String(r.name ?? '').trim().slice(0, 120);
    if (!name) continue;
    let id = String(r.id ?? '').trim().slice(0, 40);
    if (!id || used.has(id)) id = newExtraId();
    used.add(id);
    const price = Number(r.price);
    const menuItemIds = Array.isArray(r.menuItemIds)
      ? [...new Set(r.menuItemIds.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 120)
      : [];
    out.push({
      id,
      name,
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      available: r.available === undefined || r.available === null ? true : !!r.available,
      menuItemIds,
    });
  }
  return out;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Safari/iOS a veces manda HH:mm:ss en inputs time. */
const HHMM_LOOSE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

function newZoneId(): string {
  return `z_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Normaliza a HH:mm (acepta HH:mm:ss). */
export function coerceOrderingHhMm(raw: unknown): string | null {
  const m = String(raw ?? '')
    .trim()
    .match(HHMM_LOOSE);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function parseHhMm(raw: string): number | null {
  const hhmm = coerceOrderingHhMm(raw);
  if (!hhmm || !HHMM.test(hhmm)) return null;
  const [h, mi] = hhmm.split(':').map(Number);
  return h * 60 + mi;
}

function normalizeTimeWindow(raw: unknown): OrderingTimeWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { open?: unknown; close?: unknown };
  const open = coerceOrderingHhMm(o.open);
  const close = coerceOrderingHhMm(o.close);
  if (!open || !close) return null;
  return { open, close };
}

/** Acepta legacy `{ open, close }` o lista de ventanas. */
export function normalizeDayWindows(raw: unknown): OrderingDayWindows {
  if (raw === null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const wins: OrderingTimeWindow[] = [];
  const seen = new Set<string>();
  for (const row of list.slice(0, 8)) {
    const win = normalizeTimeWindow(row);
    if (!win) continue;
    const key = `${win.open}-${win.close}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wins.push(win);
  }
  if (!wins.length) return null;
  wins.sort((a, b) => (parseHhMm(a.open) ?? 0) - (parseHhMm(b.open) ?? 0));
  return wins;
}

export function normalizeOrderingHoursByWeekday(
  raw: unknown,
): OrderingHoursByWeekday | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: OrderingHoursByWeekday = {};
  let any = false;
  for (let d = 0; d <= 6; d++) {
    const key = String(d);
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const val = (raw as Record<string, unknown>)[key];
    if (val === null) {
      out[key] = null;
      any = true;
      continue;
    }
    const wins = normalizeDayWindows(val);
    if (wins) {
      out[key] = wins;
      any = true;
    } else {
      out[key] = null;
      any = true;
    }
  }
  return any ? out : null;
}

export function normalizeShopOrderingHours(raw: unknown): ShopOrderingHours | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as ShopOrderingHours;
  const takeaway = normalizeOrderingHoursByWeekday(o.takeaway);
  const delivery = normalizeOrderingHoursByWeekday(o.delivery);
  if (!takeaway && !delivery) return null;
  return { takeaway, delivery };
}

export function normalizeOrderingPayments(raw: unknown): ShopOrderingPayments | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as ShopOrderingPayments & { items?: unknown };
  const legacyMethods = Array.isArray(o.methods)
    ? ([...new Set(o.methods.map((m) => String(m).toUpperCase()))].filter(
        (m) => m === 'CASH' || m === 'TRANSFER',
      ) as OrderingPaymentMethod[])
    : [];
  let items = normalizeOrderingPayItems(o.items);
  if (!items.length) {
    items = orderingItemsFromLegacyMethods(legacyMethods);
  }
  if (!items.length) {
    items = defaultOrderingPayItems();
  }
  const methods = deriveOrderingMethods(items);
  const transferInstructions =
    String(o.transferInstructions ?? '')
      .trim()
      .slice(0, 500) || null;
  const whatsapp = String(o.whatsapp ?? '').trim().slice(0, 40) || null;
  return {
    items,
    methods,
    transferInstructions,
    whatsapp,
  };
}

export function normalizeDeliveryZones(raw: unknown): DeliveryZone[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: DeliveryZone[] = [];
  for (const row of raw.slice(0, 40)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as DeliveryZone;
    const name = String(r.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    let id = String(r.id ?? '').trim().slice(0, 40);
    if (!id || used.has(id)) id = newZoneId();
    used.add(id);
    const fee = Number(r.fee);
    const polygon = normalizeZonePolygon((r as { polygon?: unknown }).polygon);
    const colorRaw = String((r as { color?: unknown }).color ?? '')
      .trim()
      .toUpperCase();
    const color = /^#[0-9A-F]{6}$/.test(colorRaw) ? colorRaw : null;
    out.push({
      id,
      name,
      fee: Number.isFinite(fee) && fee >= 0 ? fee : 0,
      note: String(r.note ?? '').trim().slice(0, 200) || null,
      polygon,
      color,
    });
  }
  return out;
}

function normalizeZonePolygon(raw: unknown): DeliveryZonePoint[] | null {
  if (!Array.isArray(raw)) return null;
  const pts: DeliveryZonePoint[] = [];
  for (const row of raw.slice(0, 80)) {
    if (!row || typeof row !== 'object') continue;
    const lat = Number((row as DeliveryZonePoint).lat);
    const lng = Number((row as DeliveryZonePoint).lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    pts.push({ lat, lng });
  }
  return pts.length >= 3 ? pts : null;
}

/** Ray casting: punto dentro del polígono. */
export function pointInPolygon(
  point: DeliveryZonePoint,
  polygon: DeliveryZonePoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon: DeliveryZonePoint[]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += polygon[j].lng * polygon[i].lat - polygon[i].lng * polygon[j].lat;
  }
  return Math.abs(area / 2);
}

/** Zona más chica que contiene el punto (si hay solapamiento). */
export function findZoneAtPoint(
  point: DeliveryZonePoint,
  zones: DeliveryZone[],
): DeliveryZone | null {
  const hits = zones.filter(
    (z) => z.polygon && z.polygon.length >= 3 && pointInPolygon(point, z.polygon),
  );
  if (!hits.length) return null;
  hits.sort((a, b) => polygonArea(a.polygon!) - polygonArea(b.polygon!));
  return hits[0];
}

export function zonesHavePolygons(zones: DeliveryZone[]): boolean {
  return zones.some((z) => (z.polygon?.length ?? 0) >= 3);
}

export function normalizeOrderingEta(raw: unknown): ShopOrderingEta | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as ShopOrderingEta;
  const takeaway = String(o.takeaway ?? '').trim().slice(0, 80) || null;
  const delivery = String(o.delivery ?? '').trim().slice(0, 80) || null;
  if (!takeaway && !delivery) return null;
  return { takeaway, delivery };
}

export function normalizeShopMode(raw: unknown): ShopMode {
  const v = String(raw ?? '').toUpperCase();
  return v === ShopMode.AL_PASO ? ShopMode.AL_PASO : ShopMode.RESTAURANTE;
}

function isNowInWindow(cur: number, open: number, close: number): boolean {
  if (open === close) return true; // 24 h
  if (close > open) return cur >= open && cur < close;
  return cur >= open || cur < close;
}

function dayWindowsOpenAt(wins: OrderingDayWindows, cur: number): boolean {
  if (!wins?.length) return false;
  for (const win of wins) {
    const open = parseHhMm(win.open);
    const close = parseHhMm(win.close);
    if (open == null || close == null) continue;
    if (isNowInWindow(cur, open, close)) return true;
  }
  return false;
}

/**
 * ¿El canal está abierto ahora?
 * - Sin horarios configurados → abierto (si el canal está enabled).
 * - Día con null o ausente → cerrado.
 * - Cualquier ventana del día que contenga la hora actual → abierto.
 * - Ventana que cruza medianoche (close < open) se soporta; open===close = 24 h.
 */
export function isOrderingChannelOpenNow(
  hours: OrderingHoursByWeekday | null | undefined,
  now: Date,
  timezone?: string,
): boolean {
  if (!hours || !Object.keys(hours).length) return true;
  let local = now;
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
      const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const day = dayMap[wd] ?? now.getDay();
      const wins = hours[String(day)];
      if (wins === undefined || wins === null) return false;
      return dayWindowsOpenAt(wins, hour * 60 + minute);
    } catch {
      local = now;
    }
  }
  const day = local.getDay();
  const wins = hours[String(day)];
  if (wins === undefined || wins === null) return false;
  const cur = local.getHours() * 60 + local.getMinutes();
  return dayWindowsOpenAt(wins, cur);
}

export function formatOrderingHoursSummary(
  hours: OrderingHoursByWeekday | null | undefined,
): string[] {
  if (!hours) return [];
  const labels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const lines: string[] = [];
  for (let d = 0; d <= 6; d++) {
    const wins = hours[String(d)];
    if (!wins?.length) continue;
    const ranges = wins.map((w) => `${w.open} a ${w.close}hs`).join(', ');
    lines.push(`${labels[d]} ${ranges}`);
  }
  return lines;
}

type ShiftLike = {
  opensAt?: string;
  closesAt?: string;
  weekdays?: number[] | null;
};

/**
 * Arma horarios de pedidos a partir de los turnos de caja del local
 * (varios turnos el mismo día → varias franjas).
 */
export function orderingHoursFromShifts(
  shifts: ShiftLike[] | null | undefined,
): OrderingHoursByWeekday | null {
  if (!Array.isArray(shifts) || !shifts.length) return null;
  const out: OrderingHoursByWeekday = {};
  let anyOpen = false;
  for (let d = 0; d <= 6; d++) {
    const wins: OrderingTimeWindow[] = [];
    const seen = new Set<string>();
    for (const s of shifts) {
      const days =
        Array.isArray(s.weekdays) && s.weekdays.length
          ? s.weekdays.map(Number).filter((n) => n >= 0 && n <= 6)
          : [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(d)) continue;
      const open = String(s.opensAt ?? '').trim();
      const close = String(s.closesAt ?? '').trim();
      if (!HHMM.test(open) || !HHMM.test(close)) continue;
      const key = `${open}-${close}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wins.push({ open, close });
    }
    if (wins.length) {
      wins.sort((a, b) => (parseHhMm(a.open) ?? 0) - (parseHhMm(b.open) ?? 0));
      out[String(d)] = wins;
      anyOpen = true;
    } else {
      out[String(d)] = null;
    }
  }
  return anyOpen ? out : null;
}
