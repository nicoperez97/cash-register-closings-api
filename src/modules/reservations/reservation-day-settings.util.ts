import { Shop } from '../../entities/shop.entity';
import { ReservationDayNotice } from '../../entities/reservation-day-notice.entity';

export type ReservationDayOverrides = {
  signupEnabled: boolean | null;
  insideEnabled: boolean | null;
  outsideEnabled: boolean | null;
};

export function shopSignupOpen(shop: Shop): boolean {
  if (shop.reservationSignupEnabled === undefined || shop.reservationSignupEnabled === null) {
    return true;
  }
  return !!shop.reservationSignupEnabled;
}

export function shopInsideOpen(shop: Shop): boolean {
  if (shop.reservationInsideEnabled === undefined || shop.reservationInsideEnabled === null) {
    return true;
  }
  return !!shop.reservationInsideEnabled;
}

export function shopOutsideOpen(shop: Shop): boolean {
  if (shop.reservationOutsideEnabled === undefined || shop.reservationOutsideEnabled === null) {
    return true;
  }
  return !!shop.reservationOutsideEnabled;
}

export function dayOverridesFromRow(
  row: ReservationDayNotice | null | undefined,
): ReservationDayOverrides | null {
  if (!row) return null;
  const signupEnabled =
    row.signupEnabled === null || row.signupEnabled === undefined
      ? null
      : !!row.signupEnabled;
  const insideEnabled =
    row.insideEnabled === null || row.insideEnabled === undefined
      ? null
      : !!row.insideEnabled;
  const outsideEnabled =
    row.outsideEnabled === null || row.outsideEnabled === undefined
      ? null
      : !!row.outsideEnabled;
  if (signupEnabled === null && insideEnabled === null && outsideEnabled === null) {
    return null;
  }
  return { signupEnabled, insideEnabled, outsideEnabled };
}

export function effectiveReservationFlags(
  shop: Shop,
  overrides: ReservationDayOverrides | null | undefined,
): { signupEnabled: boolean; insideEnabled: boolean; outsideEnabled: boolean } {
  const signupEnabled =
    overrides?.signupEnabled === null || overrides?.signupEnabled === undefined
      ? shopSignupOpen(shop)
      : !!overrides.signupEnabled;
  if (!signupEnabled) {
    return { signupEnabled: false, insideEnabled: false, outsideEnabled: false };
  }
  let insideEnabled =
    overrides?.insideEnabled === null || overrides?.insideEnabled === undefined
      ? shopInsideOpen(shop)
      : !!overrides.insideEnabled;
  let outsideEnabled =
    overrides?.outsideEnabled === null || overrides?.outsideEnabled === undefined
      ? shopOutsideOpen(shop)
      : !!overrides.outsideEnabled;
  if (!insideEnabled && !outsideEnabled) {
    return { signupEnabled: false, insideEnabled: false, outsideEnabled: false };
  }
  return { signupEnabled, insideEnabled, outsideEnabled };
}

/** 0=domingo … 6=sábado (igual que Date#getUTCDay / closedWeekdays del local). */
export function isoDateWeekday(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? '').slice(0, 10));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)).getUTCDay();
}

export function normalizeClosedWeekdays(raw?: number[] | null): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
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

export function rowHasDayContent(row: ReservationDayNotice): boolean {
  const msg = String(row.message ?? '').trim();
  if (msg) return true;
  return (
    (row.signupEnabled !== null && row.signupEnabled !== undefined) ||
    (row.insideEnabled !== null && row.insideEnabled !== undefined) ||
    (row.outsideEnabled !== null && row.outsideEnabled !== undefined)
  );
}
