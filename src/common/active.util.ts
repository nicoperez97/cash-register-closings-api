/** Normaliza `active` de MySQL tinyint / boolean / string. */
export function isEntityActive(active: unknown): boolean {
  if (active === true || active === 1) return true;
  if (active === false || active === 0) return false;
  if (typeof active === 'string') {
    const s = active.trim().toLowerCase();
    if (s === '1' || s === 'true') return true;
    if (s === '0' || s === 'false' || s === '') return false;
  }
  if (Buffer.isBuffer(active)) {
    return active.length > 0 && active[0] !== 0;
  }
  return Boolean(active);
}
