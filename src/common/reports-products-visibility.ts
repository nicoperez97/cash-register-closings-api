/** Visibilidad granular dentro de Reportes · Ventas POS. */

export type ReportsProductsAmountMode = 'none' | 'amount' | 'qty' | 'both';

export type ReportsProductsVisibilityFlag =
  | 'kpis'
  | 'charts'
  | 'tabProducts'
  | 'tabCategories'
  | 'tabDays'
  | 'export'
  | 'import';

export type ReportsProductsVisibility = Record<ReportsProductsVisibilityFlag, boolean> & {
  amountMode: ReportsProductsAmountMode;
};

export const REPORTS_PRODUCTS_VISIBILITY_FLAGS: ReportsProductsVisibilityFlag[] = [
  'kpis',
  'charts',
  'tabProducts',
  'tabCategories',
  'tabDays',
  'export',
  'import',
];

export function defaultReportsProductsVisibility(): ReportsProductsVisibility {
  return {
    kpis: true,
    charts: true,
    tabProducts: true,
    tabCategories: true,
    tabDays: true,
    export: true,
    import: true,
    amountMode: 'both',
  };
}

function coerceBool(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return fallback;
}

function coerceAmountMode(raw: unknown): ReportsProductsAmountMode {
  if (raw === 'none' || raw === 'amount' || raw === 'qty' || raw === 'both') return raw;
  if (raw === 'price' || raw === 'importe') return 'amount';
  if (raw === 'units' || raw === 'cantidad') return 'qty';
  if (raw === 'all' || raw === 'ambos') return 'both';
  return 'both';
}

export function normalizeReportsProductsVisibility(
  raw?: Partial<ReportsProductsVisibility> | Record<string, unknown> | null,
): ReportsProductsVisibility {
  const base = defaultReportsProductsVisibility();
  if (!raw || typeof raw !== 'object') return base;
  for (const key of REPORTS_PRODUCTS_VISIBILITY_FLAGS) {
    if (raw[key] !== undefined) base[key] = coerceBool(raw[key], base[key]);
  }
  if (raw.amountMode !== undefined) base.amountMode = coerceAmountMode(raw.amountMode);
  return base;
}

export function mergeReportsProductsVisibility(
  prev: ReportsProductsVisibility | null | undefined,
  patch?: Partial<ReportsProductsVisibility> | Record<string, unknown> | null,
): ReportsProductsVisibility {
  const base = normalizeReportsProductsVisibility(prev);
  if (!patch || typeof patch !== 'object') return base;
  return normalizeReportsProductsVisibility({ ...base, ...patch });
}

export function canSeeAmount(v: ReportsProductsVisibility | null | undefined): boolean {
  const mode = normalizeReportsProductsVisibility(v).amountMode;
  return mode === 'amount' || mode === 'both';
}

export function canSeeQty(v: ReportsProductsVisibility | null | undefined): boolean {
  const mode = normalizeReportsProductsVisibility(v).amountMode;
  return mode === 'qty' || mode === 'both';
}

export function hasAnyReportsProductsBlock(
  v: ReportsProductsVisibility | null | undefined,
): boolean {
  const n = normalizeReportsProductsVisibility(v);
  return (
    n.kpis ||
    n.charts ||
    n.tabProducts ||
    n.tabCategories ||
    n.tabDays ||
    n.export ||
    n.import
  );
}
