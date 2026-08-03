/**
 * Fechas de local:
 * - resolveShopCalendarDate: día calendario (reservas, movimientos, etc.)
 * - resolveShopBusinessDate: día laboral con openingTime (solo cierres)
 */

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';
const DEFAULT_OPENING = '10:00';

export function parseOpeningMinutes(openingTime?: string | null): number {
  const raw = String(openingTime ?? DEFAULT_OPENING).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 10 * 60;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return h * 60 + min;
}

export function normalizeOpeningTime(openingTime?: string | null): string {
  const mins = parseOpeningMinutes(openingTime);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function zonedDateParts(
  when: Date,
  timeZone?: string | null,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const tz = timeZone?.trim() || DEFAULT_TZ;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(when)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function shiftCalendarDay(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/** Fecha de calendario YYYY-MM-DD en el timezone del local (sin hora de apertura). */
export function resolveShopCalendarDate(
  when: Date = new Date(),
  opts: { timezone?: string | null } = {},
): string {
  const p = zonedDateParts(when, opts.timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Día laboral YYYY-MM-DD según timezone y hora de apertura.
 * Usar solo para cierres de caja.
 */
export function resolveShopBusinessDate(
  when: Date = new Date(),
  opts: { timezone?: string | null; openingTime?: string | null } = {},
): string {
  const p = zonedDateParts(when, opts.timezone);
  const openingMins = parseOpeningMinutes(opts.openingTime);
  const nowMins = p.hour * 60 + p.minute;
  let { year, month, day } = p;
  if (nowMins < openingMins) {
    ({ year, month, day } = shiftCalendarDay(year, month, day, -1));
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Siguiente día calendario YYYY-MM-DD. */
export function nextCalendarDate(isoDate: string): string {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const n = shiftCalendarDay(y, m, d, 1);
  return `${n.year}-${pad2(n.month)}-${pad2(n.day)}`;
}

export function formatBusinessDayHint(
  businessDate: string,
  openingTime?: string | null,
): string {
  const open = normalizeOpeningTime(openingTime);
  const next = nextCalendarDate(businessDate);
  const [y1, m1, d1] = businessDate.split('-');
  const [y2, m2, d2] = next.split('-');
  return `Día laboral hasta las ${open} del ${Number(d2)}/${Number(m2)}/${y2} (desde ${open} del ${Number(d1)}/${Number(m1)}/${y1})`;
}
