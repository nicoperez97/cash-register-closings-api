import { BadRequestException } from '@nestjs/common';
import { ReservationArea } from '../../entities/reservation.entity';

export type ShopPartyRules = {
  reservationInsideMaxPartySize?: number | null;
  reservationOutsideMinPartySize?: number | null;
};

/** Vacío / 0 = sin regla. 1–99 = límite. */
export function normalizePartyRule(raw?: number | null): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(99, n);
}

export function partyMustSitOutside(
  partySize: number,
  shop: ShopPartyRules | null | undefined,
): boolean {
  const size = Math.round(Number(partySize));
  if (!Number.isFinite(size) || size < 1) return false;
  const maxInside = shop?.reservationInsideMaxPartySize;
  if (maxInside != null && Number.isFinite(Number(maxInside)) && size > Number(maxInside)) {
    return true;
  }
  const minOutside = shop?.reservationOutsideMinPartySize;
  if (minOutside != null && Number.isFinite(Number(minOutside)) && size >= Number(minOutside)) {
    return true;
  }
  return false;
}

export function outsideFromPartySize(shop: ShopPartyRules | null | undefined): number | null {
  const minOutside = shop?.reservationOutsideMinPartySize;
  if (minOutside != null && Number.isFinite(Number(minOutside)) && Number(minOutside) >= 1) {
    return Number(minOutside);
  }
  const maxInside = shop?.reservationInsideMaxPartySize;
  if (maxInside != null && Number.isFinite(Number(maxInside)) && Number(maxInside) >= 1) {
    return Number(maxInside) + 1;
  }
  return null;
}

export function assertPartyFitsShopArea(
  area: ReservationArea | string,
  partySize: number,
  shop: ShopPartyRules | null | undefined,
): void {
  if (String(area).toUpperCase() !== ReservationArea.INSIDE) return;
  if (!partyMustSitOutside(partySize, shop)) return;
  const from = outsideFromPartySize(shop) ?? partySize;
  throw new BadRequestException(
    `A partir de ${from} ${from === 1 ? 'persona' : 'personas'} la mesa es afuera`,
  );
}
