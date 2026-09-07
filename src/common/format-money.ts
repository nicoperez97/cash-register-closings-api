const MILLION = 1_000_000;

export type FormatNumberOptions = {
  /** abs >= 1.000.000 → 1M / 1,5M. Default true. */
  compact?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

/** Miles con "." · millones con M (1.000.000 → 1M). */
export function formatNumber(
  value: number | string | null | undefined,
  opts: FormatNumberOptions = {},
): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';

  const compact = opts.compact !== false;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (compact && abs >= MILLION) {
    const millions = abs / MILLION;
    const rounded = Math.round(millions * 100) / 100;
    const isInt = Math.abs(rounded - Math.round(rounded)) < 0.001;
    const body = rounded.toLocaleString('es-AR', {
      minimumFractionDigits: isInt ? 0 : 1,
      maximumFractionDigits: isInt ? 0 : 2,
    });
    return `${sign}${body}M`;
  }

  return `${sign}${abs.toLocaleString('es-AR', {
    minimumFractionDigits: opts.minimumFractionDigits ?? 0,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
  })}`;
}

/** Monto UI: $10.000,00 · $1M */
export function formatMoney(
  value: number | string | null | undefined,
  opts: FormatNumberOptions & { spaced?: boolean } = {},
): string {
  const spaced = !!opts.spaced;
  const body = formatNumber(value, {
    compact: opts.compact,
    minimumFractionDigits: opts.minimumFractionDigits ?? 2,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
  });
  if (body === '—') return spaced ? '$ —' : '$—';
  const mark = spaced ? '$ ' : '$';
  if (body.startsWith('-')) return `-${mark}${body.slice(1)}`;
  return `${mark}${body}`;
}
