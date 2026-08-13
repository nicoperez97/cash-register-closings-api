import { BadRequestException } from '@nestjs/common';
import { Shop } from '../../entities/shop.entity';
import { ReservationDayNotice } from '../../entities/reservation-day-notice.entity';
import { ReservationArea } from '../../entities/reservation.entity';

export type ReservationDayOverrides = {
  signupEnabled: boolean | null;
  insideEnabled: boolean | null;
  outsideEnabled: boolean | null;
  /** NULL = sin límite; 0 = cerrado por cupo. */
  insideCapacityRemaining: number | null;
  outsideCapacityRemaining: number | null;
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

export function normalizeCapacityRemaining(raw?: number | null): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException('El cupo debe ser 0 o más (vacío = sin límite)');
  }
  return Math.min(n, 999);
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
  const insideCapacityRemaining =
    row.insideCapacityRemaining === null || row.insideCapacityRemaining === undefined
      ? null
      : Number(row.insideCapacityRemaining);
  const outsideCapacityRemaining =
    row.outsideCapacityRemaining === null || row.outsideCapacityRemaining === undefined
      ? null
      : Number(row.outsideCapacityRemaining);
  if (
    signupEnabled === null &&
    insideEnabled === null &&
    outsideEnabled === null &&
    insideCapacityRemaining === null &&
    outsideCapacityRemaining === null
  ) {
    return null;
  }
  return {
    signupEnabled,
    insideEnabled,
    outsideEnabled,
    insideCapacityRemaining: Number.isFinite(insideCapacityRemaining as number)
      ? (insideCapacityRemaining as number)
      : null,
    outsideCapacityRemaining: Number.isFinite(outsideCapacityRemaining as number)
      ? (outsideCapacityRemaining as number)
      : null,
  };
}

export function effectiveReservationFlags(
  shop: Shop,
  overrides: ReservationDayOverrides | null | undefined,
): {
  signupEnabled: boolean;
  insideEnabled: boolean;
  outsideEnabled: boolean;
  insideCapacityRemaining: number | null;
  outsideCapacityRemaining: number | null;
} {
  const signupEnabled =
    overrides?.signupEnabled === null || overrides?.signupEnabled === undefined
      ? shopSignupOpen(shop)
      : !!overrides.signupEnabled;
  const insideCapacityRemaining =
    overrides?.insideCapacityRemaining === null ||
    overrides?.insideCapacityRemaining === undefined
      ? null
      : Number(overrides.insideCapacityRemaining);
  const outsideCapacityRemaining =
    overrides?.outsideCapacityRemaining === null ||
    overrides?.outsideCapacityRemaining === undefined
      ? null
      : Number(overrides.outsideCapacityRemaining);

  if (!signupEnabled) {
    return {
      signupEnabled: false,
      insideEnabled: false,
      outsideEnabled: false,
      insideCapacityRemaining,
      outsideCapacityRemaining,
    };
  }
  let insideEnabled =
    overrides?.insideEnabled === null || overrides?.insideEnabled === undefined
      ? shopInsideOpen(shop)
      : !!overrides.insideEnabled;
  let outsideEnabled =
    overrides?.outsideEnabled === null || overrides?.outsideEnabled === undefined
      ? shopOutsideOpen(shop)
      : !!overrides.outsideEnabled;

  if (insideCapacityRemaining === 0) insideEnabled = false;
  if (outsideCapacityRemaining === 0) outsideEnabled = false;

  if (!insideEnabled && !outsideEnabled) {
    return {
      signupEnabled: false,
      insideEnabled: false,
      outsideEnabled: false,
      insideCapacityRemaining,
      outsideCapacityRemaining,
    };
  }
  return {
    signupEnabled,
    insideEnabled,
    outsideEnabled,
    insideCapacityRemaining: Number.isFinite(insideCapacityRemaining as number)
      ? (insideCapacityRemaining as number)
      : null,
    outsideCapacityRemaining: Number.isFinite(outsideCapacityRemaining as number)
      ? (outsideCapacityRemaining as number)
      : null,
  };
}

export function assertPartyFitsAreaCapacity(
  area: ReservationArea | string,
  partySize: number,
  overrides: ReservationDayOverrides | null | undefined,
): void {
  const isOutside = String(area).toUpperCase() === ReservationArea.OUTSIDE;
  const label = isOutside ? 'afuera' : 'adentro';
  const remaining = isOutside
    ? overrides?.outsideCapacityRemaining
    : overrides?.insideCapacityRemaining;
  if (remaining === null || remaining === undefined) return;
  const cap = Number(remaining);
  if (!Number.isFinite(cap)) return;
  if (cap <= 0) {
    throw new BadRequestException(`No quedan lugares ${label}`);
  }
  if (partySize > cap) {
    throw new BadRequestException(
      `Solo quedan ${cap} lugar${cap === 1 ? '' : 'es'} ${label}`,
    );
  }
}

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

export function rowHasDayContent(row: ReservationDayNotice): boolean {
  const msg = String(row.message ?? '').trim();
  if (msg) return true;
  return (
    (row.signupEnabled !== null && row.signupEnabled !== undefined) ||
    (row.insideEnabled !== null && row.insideEnabled !== undefined) ||
    (row.outsideEnabled !== null && row.outsideEnabled !== undefined) ||
    (row.insideCapacityRemaining !== null && row.insideCapacityRemaining !== undefined) ||
    (row.outsideCapacityRemaining !== null && row.outsideCapacityRemaining !== undefined)
  );
}
