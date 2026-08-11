function utcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Normaliza DATE/Date/string a YYYY-MM-DD (evita "Wed Mar 18" al String(date)). */
export function toIsoDateOnly(v: unknown): string {
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Datetime ISO: no recortar los 10 primeros (en UTC-3 sería el día anterior).
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const dt = new Date(s);
      if (!Number.isNaN(dt.getTime())) return utcYmd(dt);
    }
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return utcYmd(v);
  }
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return utcYmd(d);
  return '';
}

export function isIsoDateOnly(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
