/** Clave de unicidad de fecha de negocio (YYYY-MM-DD o YYYY-MM-DD__shiftId). */
export function closingDateKey(businessDate: string, shiftId?: string | null): string {
  const date = String(businessDate ?? '').slice(0, 10);
  const shift = String(shiftId ?? '').trim();
  return shift ? `${date}__${shift}` : date;
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
  const clean = String(value ?? '').replace(/__DELETED__[0-9a-f]{8}$/i, '');
  const maxBase = Math.max(1, maxLen - suffix.length);
  return `${clean.slice(0, maxBase)}${suffix}`;
}
