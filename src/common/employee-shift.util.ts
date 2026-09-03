import { EmployeeType } from '../entities/employee.entity';
import {
  DEFAULT_SERVICE_CHECK_IN,
  DEFAULT_SERVICE_CHECK_OUT,
  parseHhMm,
  requireHhMm,
} from './shift-hours.util';
import type { ShopShift } from './shop-shifts';

export type EmployeeShiftAssignment = {
  shiftId: string;
  type: EmployeeType;
  /** Entrada de servicio en este turno (HH:mm). Vacío = hereda empleado/turno. */
  serviceCheckIn?: string | null;
  /** Retirada de servicio en este turno (HH:mm). Vacío = hereda empleado/turno. */
  serviceCheckOut?: string | null;
};

export function normalizeEmployeeType(value?: string | null): EmployeeType {
  return value === EmployeeType.ROTATING ? EmployeeType.ROTATING : EmployeeType.FIXED;
}

export function normalizeShiftAssignments(
  raw?: Array<{
    shiftId?: string | null;
    type?: string | null;
    serviceCheckIn?: string | null;
    serviceCheckOut?: string | null;
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

/** Horario de servicio efectivo: asignación → empleado → ventana del turno. */
export function shiftServiceSchedule(
  emp: {
    serviceCheckIn?: string | null;
    serviceCheckOut?: string | null;
    shiftAssignments?: EmployeeShiftAssignment[] | null;
  },
  shiftId: string | null | undefined,
  fallback: { checkIn: string; checkOut: string },
): { checkIn: string; checkOut: string } {
  const assignments = normalizeShiftAssignments(emp.shiftAssignments);
  const hit = shiftId ? assignments.find((a) => a.shiftId === shiftId) : assignments[0];
  return {
    checkIn: requireHhMm(
      hit?.serviceCheckIn ?? emp.serviceCheckIn,
      fallback.checkIn,
    ),
    checkOut: requireHhMm(
      hit?.serviceCheckOut ?? emp.serviceCheckOut,
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
