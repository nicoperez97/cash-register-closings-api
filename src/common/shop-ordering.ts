/** Modo operativo del local (impacta módulos sugeridos; no fuerza canales). */
export enum ShopMode {
  AL_PASO = 'AL_PASO',
  RESTAURANTE = 'RESTAURANTE',
}

export type OrderingDayWindow = { open: string; close: string } | null;

/** "0"…"6" → ventana HH:mm o null = cerrado ese día. */
export type OrderingHoursByWeekday = Record<string, OrderingDayWindow>;

export type ShopOrderingHours = {
  takeaway?: OrderingHoursByWeekday | null;
  delivery?: OrderingHoursByWeekday | null;
};

export type OrderingPaymentMethod = 'CASH' | 'TRANSFER';

export type ShopOrderingPayments = {
  methods?: OrderingPaymentMethod[];
  transferInstructions?: string | null;
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

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function newZoneId(): string {
  return `z_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function parseHhMm(raw: string): number | null {
  const m = String(raw ?? '').trim().match(HHMM);
  if (!m) return null;
  const [h, mi] = m[0].split(':').map(Number);
  return h * 60 + mi;
}

function normalizeDayWindow(raw: unknown): OrderingDayWindow {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { open?: unknown; close?: unknown };
  const open = String(o.open ?? '').trim();
  const close = String(o.close ?? '').trim();
  if (!HHMM.test(open) || !HHMM.test(close)) return null;
  return { open, close };
}

export function normalizeOrderingHoursByWeekday(
  raw: unknown,
): OrderingHoursByWeekday | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: OrderingHoursByWeekday = {};
  let any = false;
  for (let d = 0; d <= 6; d++) {
    const key = String(d);
    const win = normalizeDayWindow((raw as Record<string, unknown>)[key]);
    if (win) {
      out[key] = win;
      any = true;
    } else if (
      Object.prototype.hasOwnProperty.call(raw, key) &&
      (raw as Record<string, unknown>)[key] === null
    ) {
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
  if (!methods.length && !transferInstructions) return null;
  return {
    methods: methods.length ? methods : (['CASH', 'TRANSFER'] as OrderingPaymentMethod[]),
    transferInstructions,
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

/**
 * ¿El canal está abierto ahora?
 * - Sin horarios configurados → abierto (si el canal está enabled).
 * - Día con null o ausente → cerrado.
 * - Ventana que cruza medianoche (close < open) se soporta.
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
      const win = hours[String(day)];
      if (win === undefined || win === null) return false;
      const cur = hour * 60 + minute;
      const open = parseHhMm(win.open);
      const close = parseHhMm(win.close);
      if (open == null || close == null) return false;
      if (close > open) return cur >= open && cur < close;
      // cruza medianoche
      return cur >= open || cur < close;
    } catch {
      local = now;
    }
  }
  const day = local.getDay();
  const win = hours[String(day)];
  if (win === undefined || win === null) return false;
  const cur = local.getHours() * 60 + local.getMinutes();
  const open = parseHhMm(win.open);
  const close = parseHhMm(win.close);
  if (open == null || close == null) return false;
  if (close > open) return cur >= open && cur < close;
  return cur >= open || cur < close;
}

export function formatOrderingHoursSummary(
  hours: OrderingHoursByWeekday | null | undefined,
): string[] {
  if (!hours) return [];
  const labels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const lines: string[] = [];
  for (let d = 0; d <= 6; d++) {
    const win = hours[String(d)];
    if (!win) continue;
    lines.push(`${labels[d]} ${win.open} a ${win.close}hs`);
  }
  return lines;
}
