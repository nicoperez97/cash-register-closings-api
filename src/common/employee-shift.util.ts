import { EmployeeType } from '../entities/employee.entity';

export type EmployeeShiftAssignment = {
  shiftId: string;
  type: EmployeeType;
};

export function normalizeEmployeeType(value?: string | null): EmployeeType {
  return value === EmployeeType.ROTATING ? EmployeeType.ROTATING : EmployeeType.FIXED;
}

export function normalizeShiftAssignments(
  raw?: Array<{ shiftId?: string | null; type?: string | null }> | null,
): EmployeeShiftAssignment[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: EmployeeShiftAssignment[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const shiftId = String(row?.shiftId ?? '').trim();
    if (!shiftId || seen.has(shiftId)) continue;
    seen.add(shiftId);
    out.push({
      shiftId,
      type: normalizeEmployeeType(row?.type),
    });
  }
  return out;
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
