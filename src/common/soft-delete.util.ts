/** Clave de unicidad de fecha de negocio (YYYY-MM-DD o YYYY-MM-DD__shiftId). */
export function closingDateKey(businessDate: string, shiftId?: string | null): string {
  const date = String(businessDate ?? '').slice(0, 10);
  const shift = String(shiftId ?? '').trim();
  return shift ? `${date}__${shift}` : date;
}

/** Clave de un cierre de evento: no choca con el cierre del turno. */
export function closingEventDateKey(businessDate: string, closingId: string): string {
  const date = String(businessDate ?? '').slice(0, 10);
  const id = String(closingId ?? '').replace(/-/g, '').slice(0, 32);
  return `${date}__EVENT__${id}`;
}

export function isClosingEventKey(key?: string | null): boolean {
  return String(key ?? '').includes('__EVENT__');
}

/**
 * Libera uniques al soft-delete: `valor__DELETED__{8 hex del id}`.
 * Truncates to maxLen so columns like sales_systems.code (64) stay valid.
 */
export function markDeletedUnique(
  value: string,
  entityId: string,
  maxLen = 255,
): string {
  const suffix = `__DELETED__${String(entityId).replace(/-/g, '').slice(0, 8)}`;
  const clean = String(value ?? '').replace(/__DELETED__.*/i, '');
  const maxBase = Math.max(1, maxLen - suffix.length);
  return `${clean.slice(0, maxBase)}${suffix}`;
}

/** Quita el sufijo `__DELETED__…` para mostrar el nombre original. */
export function displaySoftDeletedLabel(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  // Cualquier cola tras el marcador (hex corto, truncado, repetido, histórico).
  const cleaned = raw.replace(/__DELETED__.*/i, '').replace(/\s+/g, ' ').trim();
  // Nunca devolver texto que aún contenga el marcador.
  if (!cleaned || /__DELETED__/i.test(cleaned)) return null;
  return cleaned;
}

export function looksSoftDeletedLabel(value?: string | null): boolean {
  return /__DELETED__/i.test(String(value ?? ''));
}
