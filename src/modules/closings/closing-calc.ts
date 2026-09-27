import { ExtraLineType } from '../../common/enums';
import { ClosingPosnetAmount, sumPosnetsByType } from '../../common/posnet';

export function closingNum(v?: number | string | null): number {
  return Number(v ?? 0);
}

export type ClosingCalcInput = {
  posSystemAmount?: number | string | null;
  cardAmount?: number | string | null;
  cashAmount?: number | string | null;
  cashOpeningAmount?: number | string | null;
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

/** Suma de egresos del cierre (el recuento de efectivo ya viene neto de estos). */
export function expensesTotalFrom(
  expenses?: Array<{ amount?: number | string | null }> | null,
): number {
  return (expenses ?? []).reduce((sum, e) => sum + closingNum(e.amount), 0);
}

/**
 * Recaudación en efectivo del día =
 * efectivo total (cierre) − efectivo de apertura + gastos en efectivo.
 */
export function cashDayCollection(
  cashAmount?: number | string | null,
  cashOpeningAmount?: number | string | null,
  expensesTotal = 0,
): number {
  return (
    closingNum(cashAmount) - closingNum(cashOpeningAmount) + closingNum(expensesTotal)
  );
}

/**
 * calculated = recaudación efectivo + otros canales + extraIncome;
 * declared: si el cliente manda total con “contado” (sin restar apertura ni sumar egresos),
 * se ajusta a la misma recaudación; si no, = calculated.
 * difference = declarado − caja sistema.
 */
export function calcClosingTotals(
  dto: ClosingCalcInput,
  extraIncome = 0,
  expensesTotal = 0,
): ClosingCalcResult {
  const cashCollected = cashDayCollection(
    dto.cashAmount,
    dto.cashOpeningAmount,
    expensesTotal,
  );
  const calculated =
    closingNum(dto.cardAmount) +
    cashCollected +
    closingNum(dto.mercadoPagoAmount) +
    closingNum(dto.deliveryAppsAmount) +
    closingNum(dto.transferAmount) +
    closingNum(dto.accountDniAmount) +
    closingNum(dto.otherAmount) +
    extraIncome;
  let declared = calculated;
  if (dto.declaredTotal !== undefined) {
    // Cliente suele mandar contado + canales (sin −apertura +egresos).
    declared =
      closingNum(dto.declaredTotal) + (cashCollected - closingNum(dto.cashAmount));
  }
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

export type SourceChannelRow = {
  name?: string | null;
  role?: string | null;
  amount?: number | string | null;
  lines?: unknown;
  posnetAmounts?: Array<{ amount?: number | string | null }> | null;
};

export type ChannelAmounts = {
  cardAmount: number;
  mercadoPagoAmount: number;
  accountDniAmount: number;
  deliveryAppsAmount: number;
  transferAmount: number;
};

function normSourceName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function amountOfSourceChannelRow(row: SourceChannelRow): number {
  const posnets = Array.isArray(row.posnetAmounts) ? row.posnetAmounts : [];
  if (posnets.length) {
    return posnets.reduce((sum, p) => sum + closingNum(p.amount), 0);
  }
  if (Array.isArray(row.lines)) {
    const lines = row.lines
      .map((v) => closingNum(typeof v === 'object' && v ? (v as { amount?: unknown }).amount : v))
      .filter((v) => v > 0);
    if (lines.length) return lines.reduce((sum, v) => sum + v, 0);
  }
  return closingNum(row.amount);
}

/**
 * Suma montos de Cuentas del local hacia las columnas canal legacy
 * (lista de cierres, reportes Excel, filtros).
 */
export function channelAmountsFromSources(
  rows: SourceChannelRow[] | null | undefined,
): ChannelAmounts {
  const out: ChannelAmounts = {
    cardAmount: 0,
    mercadoPagoAmount: 0,
    accountDniAmount: 0,
    deliveryAppsAmount: 0,
    transferAmount: 0,
  };
  for (const row of rows ?? []) {
    if (String(row.role ?? '') === 'CASH') continue;
    const amount = amountOfSourceChannelRow(row);
    if (!(amount > 0)) continue;
    const name = normSourceName(String(row.name ?? ''));
    if (!name) continue;
    if (name === 'pvs' || name.includes('pvs') || name.includes('tarjeta') || name === 'card') {
      out.cardAmount += amount;
    } else if (name.includes('mercado') || name === 'mp' || name === 'mercadopago') {
      out.mercadoPagoAmount += amount;
    } else if (name.includes('dni')) {
      out.accountDniAmount += amount;
    } else if (
      name.includes('delivery') ||
      name.includes('pedidos') ||
      name.includes('rappi') ||
      name.includes('deliberate')
    ) {
      out.deliveryAppsAmount += amount;
    } else if (name.includes('transfer')) {
      out.transferAmount += amount;
    }
  }
  return out;
}

/**
 * Si hay sourceAmounts, pisa las columnas canal legacy con la suma por nombre
 * (PVS → cardAmount, etc.). Sin sources, deja el dto igual.
 */
export function applyChannelAmountsFromSources<
  T extends ClosingCalcInput & { sourceAmounts?: SourceChannelRow[] | null },
>(dto: T): T {
  const rows = dto.sourceAmounts;
  if (!rows?.length) return dto;
  const ch = channelAmountsFromSources(rows);
  return {
    ...dto,
    cardAmount: ch.cardAmount,
    mercadoPagoAmount: ch.mercadoPagoAmount,
    accountDniAmount: ch.accountDniAmount,
    deliveryAppsAmount: ch.deliveryAppsAmount,
    transferAmount: ch.transferAmount,
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
