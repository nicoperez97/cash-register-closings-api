import { BadRequestException } from '@nestjs/common';
import { ReservationArea } from '../../entities/reservation.entity';

export type ShopPartyRules = {
  reservationInsideMaxPartySize?: number | null;
  reservationOutsideMaxPartySize?: number | null;
  /** @deprecated alias de reservationOutsideMaxPartySize */
  reservationOutsideMinPartySize?: number | null;
};

/** Vacío / 0 = ilimitado. 1–99 = tope. */
export function normalizePartyRule(raw?: number | null): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(99, n);
}

function readMaxInside(shop: ShopPartyRules | null | undefined): number | null {
  return normalizePartyRule(shop?.reservationInsideMaxPartySize);
}

function readMaxOutside(shop: ShopPartyRules | null | undefined): number | null {
  return normalizePartyRule(
    shop?.reservationOutsideMaxPartySize ?? shop?.reservationOutsideMinPartySize,
  );
}

export function partyFitsArea(
  area: ReservationArea | string,
  partySize: number,
  shop: ShopPartyRules | null | undefined,
): boolean {
  const size = Math.round(Number(partySize));
  if (!Number.isFinite(size) || size < 1) return false;
  const max =
    String(area).toUpperCase() === ReservationArea.OUTSIDE
      ? readMaxOutside(shop)
      : readMaxInside(shop);
  if (max == null) return true;
  return size <= max;
}

/** True si el grupo no entra adentro (tope adentro superado). */
export function partyMustSitOutside(
  partySize: number,
  shop: ShopPartyRules | null | undefined,
): boolean {
  return !partyFitsArea(ReservationArea.INSIDE, partySize, shop);
}

export function effectivePartyRules(
  shop: ShopPartyRules | null | undefined,
  day?: {
    insideMaxPartySize?: number | null;
    outsideMaxPartySize?: number | null;
    outsideMinPartySize?: number | null;
  } | null,
): ShopPartyRules {
  const outsideDay = day?.outsideMaxPartySize ?? day?.outsideMinPartySize;
  return {
    reservationInsideMaxPartySize:
      day?.insideMaxPartySize != null
        ? normalizePartyRule(day.insideMaxPartySize)
        : readMaxInside(shop),
    reservationOutsideMaxPartySize:
      outsideDay != null ? normalizePartyRule(outsideDay) : readMaxOutside(shop),
    reservationOutsideMinPartySize:
      outsideDay != null ? normalizePartyRule(outsideDay) : readMaxOutside(shop),
  };
}

export function assertPartyFitsShopArea(
  area: ReservationArea | string,
  partySize: number,
  shop: ShopPartyRules | null | undefined,
): void {
  if (partyFitsArea(area, partySize, shop)) return;
  const isOut = String(area).toUpperCase() === ReservationArea.OUTSIDE;
  const max = isOut ? readMaxOutside(shop) : readMaxInside(shop);
  const label = isOut ? 'afuera' : 'adentro';
  if (max == null) return;
  throw new BadRequestException(
    `${label === 'adentro' ? 'Adentro' : 'Afuera'} hasta ${max} ${max === 1 ? 'persona' : 'personas'}`,
  );
}
