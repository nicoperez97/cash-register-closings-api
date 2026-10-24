/**
 * Origen de ventas para módulos que antes leían solo Ventas POS (import Restosoft/POS):
 * - `sales`: Ventas del sistema (pedidos online, mostrador y comanda).
 * - `pos`: Ventas POS importadas.
 * - `all`: ambas, siempre mostrando el desglose para detectar si un período quedó
 *   cargado en los dos lados.
 */
export type SalesSource = 'all' | 'sales' | 'pos';

export const SALES_SOURCE_LABEL: Record<SalesSource, string> = {
  all: 'Ventas + Ventas POS',
  sales: 'Ventas',
  pos: 'Ventas POS',
};

export function normalizeSalesSource(raw: unknown): SalesSource {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'sales' || v === 'pos' ? v : 'all';
}

export function sourceIncludesSales(source: SalesSource): boolean {
  return source !== 'pos';
}

export function sourceIncludesPos(source: SalesSource): boolean {
  return source !== 'sales';
}

export type SourceAmounts = {
  /** Ventas (pedidos + comanda). */
  salesAmount: number;
  salesQty: number;
  /** Ventas POS importadas. */
  posAmount: number;
  posQty: number;
  /** Lo que cuenta según el origen elegido. */
  amount: number;
  qty: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Suma según el origen (los parciales se conservan siempre para mostrar el desglose). */
export function combineSourceAmounts(
  source: SalesSource,
  parts: { salesAmount?: number; salesQty?: number; posAmount?: number; posQty?: number },
): SourceAmounts {
  const salesAmount = round2(Number(parts.salesAmount) || 0);
  const salesQty = Number(parts.salesQty) || 0;
  const posAmount = round2(Number(parts.posAmount) || 0);
  const posQty = Number(parts.posQty) || 0;
  return {
    salesAmount,
    salesQty,
    posAmount,
    posQty,
    amount: round2(
      (sourceIncludesSales(source) ? salesAmount : 0) + (sourceIncludesPos(source) ? posAmount : 0),
    ),
    qty: (sourceIncludesSales(source) ? salesQty : 0) + (sourceIncludesPos(source) ? posQty : 0),
  };
}
