import { randomUUID } from 'crypto';
import {
  normalizeOpeningTime,
  parseOpeningMinutes,
  zonedDateParts,
} from './business-date';

export interface ShopShift {
  id: string;
  name: string;
  /** Apertura de turno (HH:mm). */
  opensAt: string;
  /** Cierre de turno (HH:mm). Puede ser de madrugada (menor o igual que la apertura). */
  closesAt: string;
  /** 0=domingo … 6=sábado. Vacío o ausente = todos los días. */
  weekdays: number[];
}

export const ALL_SHIFT_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function weekdayFromYmd(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

export function weekdayFromIsoDate(isoDate?: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? '').slice(0, 10));
  if (!m) return null;
  return weekdayFromYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function normalizeShiftWeekdays(raw?: number[] | null): number[] {
  if (!Array.isArray(raw) || !raw.length) return [...ALL_SHIFT_WEEKDAYS];
  const next = [
    ...new Set(raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)),
  ].sort((a, b) => a - b);
  return next.length ? next : [...ALL_SHIFT_WEEKDAYS];
}

export function shiftRunsOnWeekday(shift: ShopShift, weekday: number): boolean {
  const days = normalizeShiftWeekdays(shift.weekdays);
  return days.includes(((weekday % 7) + 7) % 7);
}

export function shiftsOnWeekday(shifts: ShopShift[], weekday: number): ShopShift[] {
  return shifts.filter((s) => shiftRunsOnWeekday(s, weekday));
}

export function defaultShopShift(openingTime?: string | null): ShopShift {
  const opensAt = normalizeOpeningTime(openingTime);
  return {
    id: randomUUID(),
    name: 'Turno',
    opensAt,
    closesAt: opensAt,
    weekdays: [...ALL_SHIFT_WEEKDAYS],
  };
}

export function isValidHhMm(raw?: string | null): boolean {
  return HHMM.test(String(raw ?? '').trim());
}

export function minutesOfHhMm(raw?: string | null): number {
  return parseOpeningMinutes(raw);
}

/** True si `nowMins` cae en [opens, closes). Si opens === closes, el turno cubre las 24 h. */
export function isTimeInShiftWindow(
  nowMins: number,
  opensAt: string,
  closesAt: string,
): boolean {
  const opens = minutesOfHhMm(opensAt);
  const closes = minutesOfHhMm(closesAt);
  const t = ((nowMins % (24 * 60)) + 24 * 60) % (24 * 60);
  if (opens === closes) return true;
  if (opens < closes) return t >= opens && t < closes;
  return t >= opens || t < closes;
}

export function normalizeShopShifts(
  raw?: Array<{
    id?: string;
    name?: string;
    opensAt?: string;
    closesAt?: string;
    weekdays?: number[] | null;
  }> | null,
  fallbackOpening?: string | null,
): ShopShift[] {
  const opening = normalizeOpeningTime(fallbackOpening);
  if (!Array.isArray(raw) || !raw.length) {
    return [defaultShopShift(opening)];
  }
  const out: ShopShift[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const name = String(row?.name ?? '').trim() || `Turno ${out.length + 1}`;
    const opensAt = isValidHhMm(row?.opensAt) ? String(row.opensAt).trim() : opening;
    const closesAt = isValidHhMm(row?.closesAt) ? String(row.closesAt).trim() : opensAt;
    let id = String(row?.id ?? '').trim() || randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    out.push({
      id,
      name,
      opensAt,
      closesAt,
      weekdays: normalizeShiftWeekdays(row?.weekdays),
    });
  }
  return out.length ? out : [defaultShopShift(opening)];
}

export function earliestShiftOpening(shifts: ShopShift[] | null | undefined): string {
  const list = Array.isArray(shifts) && shifts.length ? shifts : [defaultShopShift()];
  let best = list[0];
  let bestMins = minutesOfHhMm(best.opensAt);
  for (const s of list) {
    const m = minutesOfHhMm(s.opensAt);
    if (m < bestMins) {
      best = s;
      bestMins = m;
    }
  }
  return normalizeOpeningTime(best.opensAt);
}

export function earliestShiftOpeningOnWeekday(
  shifts: ShopShift[] | null | undefined,
  weekday: number,
): string {
  const all = Array.isArray(shifts) && shifts.length ? shifts : [defaultShopShift()];
  const list = shiftsOnWeekday(all, weekday);
  return earliestShiftOpening(list.length ? list : all);
}

export function findShopShift(
  shifts: ShopShift[] | null | undefined,
  shiftId?: string | null,
): ShopShift | null {
  const list = Array.isArray(shifts) ? shifts : [];
  if (!list.length) return null;
  if (shiftId) return list.find((s) => s.id === shiftId) ?? null;
  return list[0];
}

/**
 * Turno vigente: el que abrió más recientemente entre los que corren ese día
 * (y el de ayer, si todavía no abrió el de hoy).
 */
export function resolveCurrentShift(
  shifts: ShopShift[] | null | undefined,
  when: Date = new Date(),
  timezone?: string | null,
): ShopShift {
  const list = Array.isArray(shifts) && shifts.length ? shifts : [defaultShopShift()];
  const p = zonedDateParts(when, timezone);
  const nowMins = p.hour * 60 + p.minute;
  const todayWd = weekdayFromYmd(p.year, p.month, p.day);
  const yest = new Date(Date.UTC(p.year, p.month - 1, p.day - 1, 12, 0, 0));
  const yestWd = yest.getUTCDay();

  let best = list[0];
  let bestSince = Infinity;
  for (const s of list) {
    if (shiftRunsOnWeekday(s, todayWd)) {
      const since = nowMins - minutesOfHhMm(s.opensAt);
      if (since >= 0 && since < bestSince) {
        bestSince = since;
        best = s;
      }
    }
    if (shiftRunsOnWeekday(s, yestWd)) {
      const since = nowMins + 24 * 60 - minutesOfHhMm(s.opensAt);
      if (since < bestSince) {
        bestSince = since;
        best = s;
      }
    }
  }
  if (bestSince === Infinity) {
    const today = shiftsOnWeekday(list, todayWd);
    return today[0] ?? list[0];
  }
  return best;
}
