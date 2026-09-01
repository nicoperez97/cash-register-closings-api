/** Horarios de servicio (HH:mm) y horas extra respecto del rango default. */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHhMm(raw?: string | null): string | null {
  const s = String(raw ?? '').trim();
  const m = s.match(TIME_RE);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

export function requireHhMm(raw: string | null | undefined, fallback: string): string {
  return parseHhMm(raw) ?? fallback;
}

/** Minutos desde medianoche (0–1439). */
export function minutesOf(hhmm: string): number {
  const parsed = parseHhMm(hhmm);
  if (!parsed) return 0;
  const [h, m] = parsed.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Ancla un horario al turno que empieza en `startHhmm`.
 * Si el horario es menor o igual que la entrada, se cuenta al día siguiente.
 */
export function minutesOnShift(startHhmm: string, timeHhmm: string): number {
  const start = minutesOf(startHhmm);
  const t = minutesOf(timeHhmm);
  return t <= start ? t + 24 * 60 : t;
}

function roundQuarterHours(hours: number): number {
  return Math.round(hours * 4) / 4;
}

/**
 * Extra respecto del horario configurado (empleado o local), en horas (paso 0.25).
 * Por defecto solo cuenta si se fue después de la retirada.
 * `countLateArrival` / `countEarlyLeave` suman esos desvíos.
 * `countAll` equivale a ambos en true (compat).
 */
export function computeOvertimeHours(opts: {
  isPresent: boolean;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  defaultCheckIn?: string | null;
  defaultCheckOut?: string | null;
  countAll?: boolean;
  countLateArrival?: boolean;
  countEarlyLeave?: boolean;
}): number {
  if (!opts.isPresent) return 0;
  const checkIn = parseHhMm(opts.checkInAt);
  const checkOut = parseHhMm(opts.checkOutAt);
  const defaultOut = parseHhMm(opts.defaultCheckOut);
  if (!checkIn || !checkOut || !defaultOut) return 0;
  const anchor = parseHhMm(opts.defaultCheckIn) ?? checkIn;

  const schedStart = minutesOf(anchor);
  const schedEnd = minutesOnShift(anchor, defaultOut);
  let actualStart = minutesOf(checkIn);
  if (actualStart < schedStart - 12 * 60) actualStart += 24 * 60;
  const actualEnd = minutesOnShift(anchor, checkOut);

  const extraStayMin = Math.max(0, actualEnd - schedEnd);
  const countLate = opts.countLateArrival ?? !!opts.countAll;
  const countEarly = opts.countEarlyLeave ?? !!opts.countAll;
  const lateArrivalMin = countLate ? Math.max(0, actualStart - schedStart) : 0;
  const earlyLeaveMin = countEarly ? Math.max(0, schedEnd - actualEnd) : 0;
  return roundQuarterHours((lateArrivalMin + earlyLeaveMin + extraStayMin) / 60);
}

export const DEFAULT_SERVICE_CHECK_IN = '18:00';
export const DEFAULT_SERVICE_CHECK_OUT = '00:00';

/**
 * Duración del turno de servicio en horas (soporta cruce de medianoche).
 * Si faltan horarios o la duración es 0, usa `fallbackHours` (default 8).
 */
export function scheduledShiftHours(
  checkIn?: string | null,
  checkOut?: string | null,
  fallbackHours = 8,
): number {
  const start = parseHhMm(checkIn);
  const end = parseHhMm(checkOut);
  if (!start || !end) return fallbackHours > 0 ? fallbackHours : 8;
  const minutes = minutesOnShift(start, end) - minutesOf(start);
  if (minutes <= 0) return fallbackHours > 0 ? fallbackHours : 8;
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Precio/hora para liquidación: tarifa seteada, o sueldo diario ÷ horas del turno.
 */
export function dailyOvertimeHourRate(
  dailySalary: number,
  overtimeHourRate: number,
  checkIn?: string | null,
  checkOut?: string | null,
  fallbackHours = 8,
): number {
  if (overtimeHourRate > 0) return overtimeHourRate;
  const hours = scheduledShiftHours(checkIn, checkOut, fallbackHours);
  if (hours <= 0 || dailySalary <= 0) return 0;
  return dailySalary / hours;
}
