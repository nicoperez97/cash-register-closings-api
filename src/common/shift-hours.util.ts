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
 * Con `countAll`, también suma llegada tarde y retiro temprano.
 */
export function computeOvertimeHours(opts: {
  isPresent: boolean;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  defaultCheckIn?: string | null;
  defaultCheckOut?: string | null;
  countAll?: boolean;
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
  if (!opts.countAll) return roundQuarterHours(extraStayMin / 60);

  const lateArrivalMin = Math.max(0, actualStart - schedStart);
  const earlyLeaveMin = Math.max(0, schedEnd - actualEnd);
  return roundQuarterHours((lateArrivalMin + earlyLeaveMin + extraStayMin) / 60);
}

export const DEFAULT_SERVICE_CHECK_IN = '18:00';
export const DEFAULT_SERVICE_CHECK_OUT = '00:00';
