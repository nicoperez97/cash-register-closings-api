import { nextCalendarDate } from './business-date';

/** 0=domingo … 6=sábado (igual que Date#getUTCDay / closedWeekdays del local). */
export function isoDateWeekday(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? '').slice(0, 10));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)).getUTCDay();
}

export function normalizeClosedWeekdays(raw?: number[] | null): number[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    ),
  ];
}

export function isShopClosedOnDate(
  shop: { closedWeekdays?: number[] | null },
  isoDate: string,
): boolean {
  const closed = normalizeClosedWeekdays(shop.closedWeekdays);
  if (!closed.length) return false;
  const weekday = isoDateWeekday(isoDate);
  return weekday != null && closed.includes(weekday);
}

/**
 * Días hábiles inclusivos: excluye solo los francos del local (`closedWeekdays`).
 * Los fines de semana cuentan si el local abre ese día.
 */
export function countBusinessDays(
  fromDate: string,
  toDate: string,
  closedWeekdays?: number[] | null,
): number {
  const from = String(fromDate ?? '').slice(0, 10);
  const to = String(toDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 0;
  if (from > to) return 0;

  const closed = normalizeClosedWeekdays(closedWeekdays);
  let count = 0;
  let cur = from;
  while (cur <= to) {
    const weekday = isoDateWeekday(cur);
    if (weekday != null && !closed.includes(weekday)) {
      count += 1;
    }
    cur = nextCalendarDate(cur);
  }
  return count;
}
