/** Tipos de posnet / terminal de cobro electrónico. */
export enum PosnetType {
  PVS = 'PVS',
  MERCADO_PAGO = 'MERCADO_PAGO',
  CUENTA_DNI = 'CUENTA_DNI',
}

export interface ShopPosnet {
  id: string;
  name: string;
  type: PosnetType;
}

/** Montos cargados por posnet en un cierre (snapshot). */
export interface ClosingPosnetAmount {
  posnetId: string;
  name: string;
  type: PosnetType;
  amount: number;
}

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
    switch (row.type) {
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
