import { SelectQueryBuilder } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingStatus } from '../../common/enums';

export type ClosingPaymentMethod =
  | 'card'
  | 'cash'
  | 'mp'
  | 'delivery'
  | 'transfer'
  | 'dni'
  | 'other';

export type ClosingSource = 'manual' | 'whatsapp' | 'excel';

export interface ClosingListFilters {
  from?: string;
  to?: string;
  status?: ClosingStatus | string;
  withdrawnByUserId?: string;
  createdByUserId?: string;
  minTotal?: number;
  maxTotal?: number;
  hasDifference?: 'yes' | 'no' | string;
  paymentMethod?: ClosingPaymentMethod | string;
  source?: ClosingSource | string;
  q?: string;
}

/** Parsea query params HTTP a filtros tipados. */
export function parseClosingFilters(query: Record<string, string | undefined>): ClosingListFilters {
  const num = (v?: string) => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    from: query['from'] || undefined,
    to: query['to'] || undefined,
    status: query['status'] || undefined,
    withdrawnByUserId: query['withdrawnByUserId'] || undefined,
    createdByUserId: query['createdByUserId'] || undefined,
    minTotal: num(query['minTotal']),
    maxTotal: num(query['maxTotal']),
    hasDifference: query['hasDifference'] || undefined,
    paymentMethod: query['paymentMethod'] || undefined,
    source: query['source'] || undefined,
    q: query['q']?.trim() || undefined,
  };
}

export function applyClosingFilters(
  qb: SelectQueryBuilder<CashClosing>,
  alias: string,
  filters: ClosingListFilters,
): void {
  const { from, to } = filters;
  if (from && to) {
    qb.andWhere(`${alias}.businessDate BETWEEN :from AND :to`, { from, to });
  } else if (from) {
    qb.andWhere(`${alias}.businessDate >= :from`, { from });
  } else if (to) {
    qb.andWhere(`${alias}.businessDate <= :to`, { to });
  }

  if (filters.status && Object.values(ClosingStatus).includes(filters.status as ClosingStatus)) {
    qb.andWhere(`${alias}.status = :status`, { status: filters.status });
  }

  if (filters.withdrawnByUserId) {
    qb.andWhere(`${alias}.cashWithdrawnByUserId = :withdrawnByUserId`, {
      withdrawnByUserId: filters.withdrawnByUserId,
    });
  }

  if (filters.createdByUserId) {
    qb.andWhere(`${alias}.createdByUserId = :createdByUserId`, {
      createdByUserId: filters.createdByUserId,
    });
  }

  if (filters.minTotal != null) {
    qb.andWhere(`${alias}.declaredTotal >= :minTotal`, { minTotal: filters.minTotal });
  }
  if (filters.maxTotal != null) {
    qb.andWhere(`${alias}.declaredTotal <= :maxTotal`, { maxTotal: filters.maxTotal });
  }

  if (filters.hasDifference === 'yes') {
    qb.andWhere(`${alias}.difference <> 0`);
  } else if (filters.hasDifference === 'no') {
    qb.andWhere(`${alias}.difference = 0`);
  }

  const paymentCols: Record<string, string> = {
    card: 'cardAmount',
    cash: 'cashAmount',
    mp: 'mercadoPagoAmount',
    delivery: 'deliveryAppsAmount',
    transfer: 'transferAmount',
    dni: 'accountDniAmount',
    other: 'otherAmount',
  };
  const payCol = filters.paymentMethod ? paymentCols[filters.paymentMethod] : undefined;
  if (payCol) {
    qb.andWhere(`${alias}.${payCol} > 0`);
  }

  if (filters.source === 'whatsapp') {
    qb.andWhere(`${alias}.notes LIKE :srcWa`, { srcWa: '%Importado desde WhatsApp%' });
  } else if (filters.source === 'excel') {
    qb.andWhere(`${alias}.notes LIKE :srcXl`, { srcXl: '%Importado desde Excel%' });
  } else if (filters.source === 'manual') {
    qb.andWhere(
      `(${alias}.notes IS NULL OR (${alias}.notes NOT LIKE :srcWa AND ${alias}.notes NOT LIKE :srcXl))`,
      {
        srcWa: '%Importado desde WhatsApp%',
        srcXl: '%Importado desde Excel%',
      },
    );
  }

  if (filters.q) {
    qb.andWhere(
      `(${alias}.notes LIKE :q OR ${alias}.cashWithdrawnByName LIKE :q OR ${alias}.differenceReason LIKE :q)`,
      { q: `%${filters.q}%` },
    );
  }
}
