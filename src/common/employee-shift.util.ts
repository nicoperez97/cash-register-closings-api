import { EmployeeType } from '../entities/employee.entity';
import {
  DEFAULT_SERVICE_CHECK_IN,
  DEFAULT_SERVICE_CHECK_OUT,
  parseHhMm,
  requireHhMm,
} from './shift-hours.util';
import type { ShopShift } from './shop-shifts';

/** Días de la semana: 0 = Domingo … 6 = Sábado (getDay estándar). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Override de horario para un día puntual dentro de un turno. */
export type ShiftDayHours = {
  serviceCheckIn?: string | null;
  serviceCheckOut?: string | null;
};

export type EmployeeShiftAssignment = {
  shiftId: string;
  type: EmployeeType;
  /** Entrada de servicio en este turno (HH:mm). Vacío = hereda empleado/turno. */
  serviceCheckIn?: string | null;
  /** Retirada de servicio en este turno (HH:mm). Vacío = hereda empleado/turno. */
  serviceCheckOut?: string | null;
  /**
   * Overrides por día de la semana (clave '0'..'6'). Vacío = usa el horario del
   * turno. Permite, p. ej., 18:00–00:00 de lunes a viernes y 20:00–02:00 el sábado.
   */
  days?: Record<string, ShiftDayHours> | null;
};

/** Día de la semana (0=Dom..6=Sáb) de una fecha 'YYYY-MM-DD'. null si inválida. */
export function weekdayOf(date?: string | null): number | null {
  const s = String(date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  const wd = d.getDay();
  return Number.isNaN(wd) ? null : wd;
}

function normalizeShiftDays(
  raw: unknown,
): Record<string, ShiftDayHours> | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, { serviceCheckIn?: string | null; serviceCheckOut?: string | null }>;
  const out: Record<string, ShiftDayHours> = {};
  for (const wd of WEEKDAYS) {
    const row = src[wd] ?? src[String(wd)];
    if (!row || typeof row !== 'object') continue;
    const checkIn = parseHhMm(row.serviceCheckIn);
    const checkOut = parseHhMm(row.serviceCheckOut);
    if (checkIn || checkOut) {
      out[String(wd)] = { serviceCheckIn: checkIn, serviceCheckOut: checkOut };
    }
  }
  return Object.keys(out).length ? out : null;
}

export function normalizeEmployeeType(value?: string | null): EmployeeType {
  return value === EmployeeType.ROTATING ? EmployeeType.ROTATING : EmployeeType.FIXED;
}

export function normalizeShiftAssignments(
  raw?: Array<{
    shiftId?: string | null;
    type?: string | null;
    serviceCheckIn?: string | null;
    serviceCheckOut?: string | null;
    days?: unknown;
  }> | null,
): EmployeeShiftAssignment[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: EmployeeShiftAssignment[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const shiftId = String(row?.shiftId ?? '').trim();
    if (!shiftId || seen.has(shiftId)) continue;
    seen.add(shiftId);
    const checkIn = parseHhMm(row?.serviceCheckIn);
    const checkOut = parseHhMm(row?.serviceCheckOut);
    out.push({
      shiftId,
      type: normalizeEmployeeType(row?.type),
      serviceCheckIn: checkIn,
      serviceCheckOut: checkOut,
      days: normalizeShiftDays(row?.days),
    });
  }
  return out;
}

/** Ventana del turno de caja como fallback de entrada/retirada. */
export function shiftWindowFallback(
  shifts: Array<Pick<ShopShift, 'id' | 'opensAt' | 'closesAt'>>,
  shiftId?: string | null,
): { checkIn: string; checkOut: string } {
  const hit = shiftId
    ? shifts.find((s) => s.id === shiftId)
    : shifts[0];
  return {
    checkIn: requireHhMm(hit?.opensAt, DEFAULT_SERVICE_CHECK_IN),
    checkOut: requireHhMm(hit?.closesAt, DEFAULT_SERVICE_CHECK_OUT),
  };
}

/**
 * Horario de servicio efectivo.
 * Prioridad: día del turno → turno → empleado → ventana del turno.
 * `weekday` (0=Dom..6=Sáb) habilita los overrides por día; null los ignora.
 */
export function shiftServiceSchedule(
  emp: {
    serviceCheckIn?: string | null;
    serviceCheckOut?: string | null;
    shiftAssignments?: EmployeeShiftAssignment[] | null;
  },
  shiftId: string | null | undefined,
  fallback: { checkIn: string; checkOut: string },
  weekday?: number | null,
): { checkIn: string; checkOut: string } {
  const assignments = normalizeShiftAssignments(emp.shiftAssignments);
  const hit = shiftId ? assignments.find((a) => a.shiftId === shiftId) : assignments[0];
  const dayOverride =
    hit && weekday != null && hit.days ? hit.days[String(weekday)] : null;
  return {
    checkIn: requireHhMm(
      dayOverride?.serviceCheckIn ?? hit?.serviceCheckIn ?? emp.serviceCheckIn,
      fallback.checkIn,
    ),
    checkOut: requireHhMm(
      dayOverride?.serviceCheckOut ?? hit?.serviceCheckOut ?? emp.serviceCheckOut,
      fallback.checkOut,
    ),
  };
}

/** Tipo efectivo en un turno. Sin asignaciones = usa type legacy en todos. */
export function employeeTypeForShift(
  emp: {
    type?: string | null;
    shiftAssignments?: EmployeeShiftAssignment[] | null;
  },
  shiftId?: string | null,
): EmployeeType {
  const assignments = normalizeShiftAssignments(emp.shiftAssignments);
  if (!assignments.length) return normalizeEmployeeType(emp.type);
  if (!shiftId) {
    return assignments.some((a) => a.type === EmployeeType.FIXED)
      ? EmployeeType.FIXED
      : EmployeeType.ROTATING;
  }
  const hit = assignments.find((a) => a.shiftId === shiftId);
  return hit ? hit.type : EmployeeType.ROTATING;
}

/** Si el empleado trabaja ese turno (sin asignaciones = todos). */
export function employeeWorksShift(
  emp: { shiftAssignments?: EmployeeShiftAssignment[] | null },
  shiftId?: string | null,
): boolean {
  const assignments = normalizeShiftAssignments(emp.shiftAssignments);
  if (!assignments.length) return true;
  if (!shiftId) return true;
  return assignments.some((a) => a.shiftId === shiftId);
}

/** Tipo legacy derivado de las asignaciones (para listados sin turno). */
export function deriveEmployeeType(
  assignments: EmployeeShiftAssignment[],
  fallback?: string | null,
): EmployeeType {
  if (!assignments.length) return normalizeEmployeeType(fallback);
  return assignments.some((a) => a.type === EmployeeType.FIXED)
    ? EmployeeType.FIXED
    : EmployeeType.ROTATING;
}
