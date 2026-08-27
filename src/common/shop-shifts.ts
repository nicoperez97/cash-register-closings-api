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
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultShopShift(openingTime?: string | null): ShopShift {
  const opensAt = normalizeOpeningTime(openingTime);
  return {
    id: randomUUID(),
    name: 'Turno',
    opensAt,
    closesAt: opensAt,
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
  raw?: Array<{ id?: string; name?: string; opensAt?: string; closesAt?: string }> | null,
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
    const opensAt = isValidHhMm(row?.opensAt)
      ? String(row.opensAt).trim()
      : opening;
    const closesAt = isValidHhMm(row?.closesAt)
      ? String(row.closesAt).trim()
      : opensAt;
    let id = String(row?.id ?? '').trim() || randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    out.push({ id, name, opensAt, closesAt });
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
 * Turno vigente: el que abrió más recientemente.
 * Sigue hasta que abre el siguiente (no hasta su hora de cierre).
 */
export function resolveCurrentShift(
  shifts: ShopShift[] | null | undefined,
  when: Date = new Date(),
  timezone?: string | null,
): ShopShift {
  const list = Array.isArray(shifts) && shifts.length ? shifts : [defaultShopShift()];
  if (list.length === 1) return list[0];
  const p = zonedDateParts(when, timezone);
  const nowMins = p.hour * 60 + p.minute;
  let best = list[0];
  let bestSince = Infinity;
  for (const s of list) {
    let since = nowMins - minutesOfHhMm(s.opensAt);
    if (since < 0) since += 24 * 60;
    if (since < bestSince) {
      bestSince = since;
      best = s;
    }
  }
  return best;
}
