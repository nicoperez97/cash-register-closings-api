/**
 * «A cargo» de una mesa: un empleado (waiterEmployeeId) o, si la abrió desde
 * Operación → Comanda un usuario sin empleado vinculado, ese usuario
 * (waiterUserId + waiterUserName como snapshot del nombre).
 */

/** Valor que manda el front para «el usuario logueado» al abrir mesa. */
export const STAFF_SELF_WAITER = 'self';

/** Prefijo de la clave de listados/filtros cuando el responsable es un usuario. */
export const USER_WAITER_PREFIX = 'user:';

type SessionWaiterFields = {
  waiterEmployeeId?: string | null;
  waiterUserId?: string | null;
  waiterUserName?: string | null;
};

/** Clave para listados y filtros: id de empleado o `user:<id>`. */
export function sessionWaiterKey(s: SessionWaiterFields | null | undefined): string | null {
  const emp = String(s?.waiterEmployeeId ?? '').trim();
  if (emp) return emp;
  const uid = String(s?.waiterUserId ?? '').trim();
  return uid ? `${USER_WAITER_PREFIX}${uid}` : null;
}

/** Nombre a mostrar: el del empleado si hay; si no, el del usuario que abrió la mesa. */
export function sessionWaiterName(
  s: SessionWaiterFields | null | undefined,
  employeeName?: string | null,
): string | null {
  const emp = String(employeeName ?? '').trim();
  if (emp) return emp;
  if (String(s?.waiterEmployeeId ?? '').trim()) return null;
  return String(s?.waiterUserName ?? '').trim() || null;
}

/** Filtro por responsable (`user:<id>` → usuario; si no, empleado). */
export function waiterFilterWhere(key: string): { waiterEmployeeId: string } | { waiterUserId: string } {
  return key.startsWith(USER_WAITER_PREFIX)
    ? { waiterUserId: key.slice(USER_WAITER_PREFIX.length) }
    : { waiterEmployeeId: key };
}
