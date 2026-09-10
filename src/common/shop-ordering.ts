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

export type ShopOrderingPayments = {
  methods?: OrderingPaymentMethod[];
  transferInstructions?: string | null;
  /** WhatsApp para comprobantes de transferencia. Si vacío, se usa el teléfono del local. */
  whatsapp?: string | null;
};

export type DeliveryZone = {
  id: string;
  name: string;
  fee: number;
  note?: string | null;
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
  const o = raw as ShopOrderingPayments;
  const methods = Array.isArray(o.methods)
    ? ([...new Set(o.methods.map((m) => String(m).toUpperCase()))].filter(
        (m) => m === 'CASH' || m === 'TRANSFER',
      ) as OrderingPaymentMethod[])
    : [];
  const transferInstructions =
    String(o.transferInstructions ?? '')
      .trim()
      .slice(0, 500) || null;
  const whatsapp = String(o.whatsapp ?? '').trim().slice(0, 40) || null;
  if (!methods.length && !transferInstructions && !whatsapp) return null;
  return {
    methods: methods.length ? methods : (['CASH', 'TRANSFER'] as OrderingPaymentMethod[]),
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
    out.push({
      id,
      name,
      fee: Number.isFinite(fee) && fee >= 0 ? fee : 0,
      note: String(r.note ?? '').trim().slice(0, 200) || null,
    });
  }
  return out;
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
