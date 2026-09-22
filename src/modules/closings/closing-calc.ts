import { ExtraLineType } from '../../common/enums';
import { ClosingPosnetAmount, sumPosnetsByType } from '../../common/posnet';

export function closingNum(v?: number | string | null): number {
  return Number(v ?? 0);
}

export type ClosingCalcInput = {
  posSystemAmount?: number | string | null;
  cardAmount?: number | string | null;
  cashAmount?: number | string | null;
  mercadoPagoAmount?: number | string | null;
  deliveryAppsAmount?: number | string | null;
  transferAmount?: number | string | null;
  accountDniAmount?: number | string | null;
  otherAmount?: number | string | null;
  declaredTotal?: number | string | null;
};

export type ClosingCalcResult = {
  calculatedTotal: number;
  declaredTotal: number;
  difference: number;
};

/** calculated = canales + extraIncome; difference = declarado − caja sistema. */
export function calcClosingTotals(dto: ClosingCalcInput, extraIncome = 0): ClosingCalcResult {
  const calculated =
    closingNum(dto.cardAmount) +
    closingNum(dto.cashAmount) +
    closingNum(dto.mercadoPagoAmount) +
    closingNum(dto.deliveryAppsAmount) +
    closingNum(dto.transferAmount) +
    closingNum(dto.accountDniAmount) +
    closingNum(dto.otherAmount) +
    extraIncome;
  const declared = dto.declaredTotal !== undefined ? closingNum(dto.declaredTotal) : calculated;
  return {
    calculatedTotal: calculated,
    declaredTotal: declared,
    difference: declared - closingNum(dto.posSystemAmount),
  };
}

export function extraIncomeFromLines(
  lines?: Array<{ type?: string | null; amount?: number | string | null }> | null,
): number {
  return (lines ?? [])
    .filter((e) => e.type === ExtraLineType.STUDENT_CASH || e.type === ExtraLineType.ADJUSTMENT)
    .reduce((sum, e) => sum + closingNum(e.amount), 0);
}

/**
 * Si hay montos por posnet, sobrescribe solo los canales presentes en el listado.
 * Así, sin posnets PVS/MP/DNI no se pisan los montos cargados a mano.
 */
export function applyPosnetSums<T extends { posnetAmounts?: ClosingPosnetAmount[] | null }>(
  dto: T,
): T {
  if (dto.posnetAmounts === undefined) return dto;
  if (dto.posnetAmounts === null || dto.posnetAmounts.length === 0) {
    return { ...dto, posnetAmounts: dto.posnetAmounts ?? [] };
  }
  const rows = dto.posnetAmounts;
  const sums = sumPosnetsByType(rows);
  const hasType = (type: string) => rows.some((r) => r.type === type);
  return {
    ...dto,
    ...(hasType('PVS') ? { cardAmount: sums.cardAmount } : {}),
    ...(hasType('MERCADO_PAGO') ? { mercadoPagoAmount: sums.mercadoPagoAmount } : {}),
    ...(hasType('CUENTA_DNI') ? { accountDniAmount: sums.accountDniAmount } : {}),
  };
}

/** true si el local pide motivo y |diff| llega al tope sin texto. */
export function differenceReasonMissing(
  minAmount: number,
  difference: number,
  reason?: string | null,
): boolean {
  const min = Math.max(0, closingNum(minAmount));
  if (!(min > 0) || Math.abs(closingNum(difference)) < min) return false;
  return !String(reason ?? '').trim();
}
