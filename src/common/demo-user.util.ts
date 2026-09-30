/**
 * Usuarios/emails de seed o demo: nunca deben recibir mail ni push reales.
 * La demo del front es offline; este usuario en DB solo existe por seeds viejos
 * o DEMO_LOGIN_ENABLED en la API.
 */

export const DEMO_ADMIN_USER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

/** Dirección no enrutable (mismo criterio que @import.cierres.local). */
export const DEMO_ADMIN_EMAIL = 'demo.admin@demo.cierres.local';

/** Correos históricos / seed que rebotan o no son reales. */
const NON_DELIVERABLE_EXACT = new Set(
  [
    DEMO_ADMIN_EMAIL,
    'demo.admin@cierres.com',
    'admin@cierres.com',
    'manager@cierres.com',
    'cashier@cierres.com',
  ].map((e) => e.toLowerCase()),
);

const NON_DELIVERABLE_DOMAIN =
  /@(?:import|demo)\.cierres\.local$/i;

export function isDemoStaffUserId(userId?: string | null): boolean {
  return !!userId && userId === DEMO_ADMIN_USER_ID;
}

export function isNonDeliverableStaffEmail(email?: string | null): boolean {
  const e = String(email ?? '')
    .trim()
    .toLowerCase();
  if (!e) return true;
  if (NON_DELIVERABLE_EXACT.has(e)) return true;
  if (NON_DELIVERABLE_DOMAIN.test(e)) return true;
  return false;
}

/** No crear notificación in-app, push ni mail para este staff. */
export function shouldNeverNotifyStaff(opts: {
  userId?: string | null;
  email?: string | null;
}): boolean {
  if (isDemoStaffUserId(opts.userId)) return true;
  if (opts.email != null && isNonDeliverableStaffEmail(opts.email)) return true;
  return false;
}
