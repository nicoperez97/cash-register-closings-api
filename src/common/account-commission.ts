/** Comisión de una cuenta: overlay de visualización, no mueve el libro. */

export function roundMoney(v: number): number {
  return Math.round(Number(v ?? 0) * 100) / 100;
}

export function parseCommissionPercent(raw?: number | string | null): number {
  const x = Number(raw ?? 0);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(Math.min(100, x) * 100) / 100;
}

export function accountCommissionOf(gross: number, percentRaw?: number | string | null) {
  const grossBalance = roundMoney(gross);
  const commissionPercent = parseCommissionPercent(percentRaw);
  if (commissionPercent <= 0) {
    return {
      commissionPercent: 0,
      commissionAmount: 0,
      netBalance: grossBalance,
      grossBalance,
    };
  }
  const commissionAmount = roundMoney(grossBalance * (commissionPercent / 100));
  return {
    commissionPercent,
    commissionAmount,
    netBalance: roundMoney(grossBalance - commissionAmount),
    grossBalance,
  };
}
