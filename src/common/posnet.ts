/** @deprecated Preferir posnets sin type colgados de ShopClosingSource. */
export enum PosnetType {
  PVS = 'PVS',
  MERCADO_PAGO = 'MERCADO_PAGO',
  CUENTA_DNI = 'CUENTA_DNI',
}

/** Terminal de cobro (sin tipo: la cuenta del local es la identidad). */
export interface SourcePosnet {
  id: string;
  name: string;
}

/** @deprecated Usar SourcePosnet en cuentas del local. */
export interface ShopPosnet {
  id: string;
  name: string;
  type?: PosnetType | string;
}

/** Montos por posnet en un cierre (snapshot), anidados en ClosingSourceAmount. */
export interface SourcePosnetAmount {
  posnetId: string;
  name: string;
  amount: number;
}

/** @deprecated Snapshot top-level en cash_closings; preferir source.posnetAmounts. */
export interface ClosingPosnetAmount {
  posnetId: string;
  name: string;
  type?: PosnetType | string;
  amount: number;
}

export function sumSourcePosnetAmounts(
  amounts: SourcePosnetAmount[] | null | undefined,
): number {
  let total = 0;
  for (const row of amounts ?? []) {
    const amount = Number(row.amount ?? 0);
    if (Number.isFinite(amount)) total += amount;
  }
  return total;
}

/** @deprecated Solo lectura de cierres históricos tipados. */
export function sumPosnetsByType(amounts: ClosingPosnetAmount[] | null | undefined): {
  cardAmount: number;
  mercadoPagoAmount: number;
  accountDniAmount: number;
} {
  let cardAmount = 0;
  let mercadoPagoAmount = 0;
  let accountDniAmount = 0;
  for (const row of amounts ?? []) {
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const type = String(row.type ?? '');
    switch (type) {
      case PosnetType.PVS:
        cardAmount += amount;
        break;
      case PosnetType.MERCADO_PAGO:
        mercadoPagoAmount += amount;
        break;
      case PosnetType.CUENTA_DNI:
        accountDniAmount += amount;
        break;
    }
  }
  return { cardAmount, mercadoPagoAmount, accountDniAmount };
}
