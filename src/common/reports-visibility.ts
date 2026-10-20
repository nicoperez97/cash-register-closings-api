/**
 * Visibilidad granular de los reportes (Cierres, Conceptos, Ventas de carta y
 * Estadísticas), igual que Reportes · Ventas POS pero en una sola columna
 * user_shops.reportsVisibility con una entrada por reporte.
 * Ventas POS sigue en su columna propia (reportsProductsVisibility).
 */

export type ReportAmountMode = 'none' | 'amount' | 'qty' | 'both';

export const REPORT_VISIBILITY_SCHEMA = {
  /** Reportes · Cierres. La descarga la sigue controlando el nivel Excel del módulo. */
  closings: ['kpis', 'detail', 'expenses'],
  /** Reportes · Conceptos. */
  concepts: ['kpis', 'charts', 'tabConcepts', 'tabDays', 'export'],
  /** Reportes · Ventas (carta: pedidos online + comanda). */
  sales: ['kpis', 'charts', 'tabProducts', 'tabCategories', 'tabDays', 'export'],
  /** Reportes · Estadísticas. */
  stats: ['kpis', 'charts', 'tips', 'daily'],
} as const;

export type ReportKey = keyof typeof REPORT_VISIBILITY_SCHEMA;
export type ReportFlag<K extends ReportKey> = (typeof REPORT_VISIBILITY_SCHEMA)[K][number];

/** Reportes que además eligen qué datos numéricos ver (importe / cantidad). */
export const REPORTS_WITH_AMOUNT_MODE: readonly ReportKey[] = ['sales'];

export type ReportVisibility<K extends ReportKey> = Record<ReportFlag<K>, boolean> & {
  amountMode?: ReportAmountMode;
};

export type ReportsVisibility = { [K in ReportKey]: ReportVisibility<K> };

export const REPORT_KEYS = Object.keys(REPORT_VISIBILITY_SCHEMA) as ReportKey[];

function coerceBool(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return fallback;
}

function coerceAmountMode(raw: unknown): ReportAmountMode {
  if (raw === 'none' || raw === 'amount' || raw === 'qty' || raw === 'both') return raw;
  return 'both';
}

export function defaultReportVisibility<K extends ReportKey>(key: K): ReportVisibility<K> {
  const out = {} as Record<string, boolean | ReportAmountMode>;
  for (const flag of REPORT_VISIBILITY_SCHEMA[key]) out[flag] = true;
  if (REPORTS_WITH_AMOUNT_MODE.includes(key)) out['amountMode'] = 'both';
  return out as ReportVisibility<K>;
}

export function normalizeReportVisibility<K extends ReportKey>(
  key: K,
  raw?: Record<string, unknown> | null,
): ReportVisibility<K> {
  const base = defaultReportVisibility(key) as Record<string, boolean | ReportAmountMode>;
  if (!raw || typeof raw !== 'object') return base as ReportVisibility<K>;
  for (const flag of REPORT_VISIBILITY_SCHEMA[key]) {
    if (raw[flag] !== undefined) base[flag] = coerceBool(raw[flag], true);
  }
  if (REPORTS_WITH_AMOUNT_MODE.includes(key) && raw['amountMode'] !== undefined) {
    base['amountMode'] = coerceAmountMode(raw['amountMode']);
  }
  return base as ReportVisibility<K>;
}

/** Todos los reportes; lo que no esté guardado queda visible (como antes de existir la config). */
export function normalizeReportsVisibility(raw?: Record<string, unknown> | null): ReportsVisibility {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {} as Record<ReportKey, unknown>;
  for (const key of REPORT_KEYS) {
    out[key] = normalizeReportVisibility(key, src[key] as Record<string, unknown> | null);
  }
  return out as ReportsVisibility;
}

/** Aplica un patch parcial (por reporte y por flag) sobre lo guardado. */
export function mergeReportsVisibility(
  prev: Record<string, unknown> | null | undefined,
  patch?: Record<string, unknown> | null,
): ReportsVisibility {
  const base = normalizeReportsVisibility(prev);
  if (!patch || typeof patch !== 'object') return base;
  const merged: Record<string, unknown> = { ...base };
  for (const key of REPORT_KEYS) {
    const p = patch[key];
    if (p && typeof p === 'object') {
      merged[key] = { ...(base[key] as object), ...(p as object) };
    }
  }
  return normalizeReportsVisibility(merged);
}

export function reportCanSeeAmount(v: { amountMode?: ReportAmountMode }): boolean {
  const mode = v.amountMode ?? 'both';
  return mode === 'amount' || mode === 'both';
}

export function reportCanSeeQty(v: { amountMode?: ReportAmountMode }): boolean {
  const mode = v.amountMode ?? 'both';
  return mode === 'qty' || mode === 'both';
}

/** Config efectiva de un reporte: los admins globales ven todo, como en Ventas POS. */
export function reportVisibilityForLink<K extends ReportKey>(
  key: K,
  isGlobalAdmin: boolean,
  linkRaw: unknown,
): ReportVisibility<K> {
  if (isGlobalAdmin) return defaultReportVisibility(key);
  const all = linkRaw && typeof linkRaw === 'object' ? (linkRaw as Record<string, unknown>) : null;
  return normalizeReportVisibility(key, (all?.[key] as Record<string, unknown> | null) ?? null);
}
