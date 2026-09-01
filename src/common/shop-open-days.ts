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

/** Lunes de la semana (lun–dom) que contiene `isoDate`. */
export function mondayOfWeek(isoDate: string): string | null {
  const weekday = isoDateWeekday(isoDate);
  if (weekday == null) return null;
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  let cur = String(isoDate).slice(0, 10);
  for (let i = 0; i < daysFromMonday; i++) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cur);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
    d.setUTCDate(d.getUTCDate() - 1);
    cur = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return cur;
}

/**
 * Semanas completas (lun–dom) en el rango: todos los días hábiles del local
 * que caen en esa semana ∩ rango están cubiertos (presente o feriado).
 * Semanas sin días hábiles en el rango no cuentan.
 */
export function countCompletedAttendanceWeeks(
  fromDate: string,
  toDate: string,
  closedWeekdays: number[] | null | undefined,
  coveredDates: Set<string>,
): number {
  const from = String(fromDate ?? '').slice(0, 10);
  const to = String(toDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 0;
  if (from > to) return 0;

  const closed = new Set(normalizeClosedWeekdays(closedWeekdays));
  const startMonday = mondayOfWeek(from);
  if (!startMonday) return 0;

  let completed = 0;
  let weekStart = startMonday;
  let guard = 0;
  while (weekStart <= to && guard < 80) {
    guard += 1;
    const required: string[] = [];
    let day = weekStart;
    for (let i = 0; i < 7; i++) {
      if (day >= from && day <= to) {
        const wd = isoDateWeekday(day);
        if (wd != null && !closed.has(wd)) required.push(day);
      }
      day = nextCalendarDate(day);
    }
    if (required.length > 0 && required.every((d) => coveredDates.has(d))) {
      completed += 1;
    }
    weekStart = day;
  }
  return completed;
}
