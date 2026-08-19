/** Horarios de servicio (HH:mm) y horas extra respecto de la retirada default. */

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

/**
 * Extra = max(0, salida real − retirada default), en horas (paso 0.25).
 * Si falta algún horario o no está presente, 0.
 */
export function computeOvertimeHours(opts: {
  isPresent: boolean;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  defaultCheckOut?: string | null;
}): number {
  if (!opts.isPresent) return 0;
  const checkIn = parseHhMm(opts.checkInAt);
  const checkOut = parseHhMm(opts.checkOutAt);
  const defaultOut = parseHhMm(opts.defaultCheckOut);
  if (!checkIn || !checkOut || !defaultOut) return 0;
  const actualEnd = minutesOnShift(checkIn, checkOut);
  const defaultEnd = minutesOnShift(checkIn, defaultOut);
  const extraMin = Math.max(0, actualEnd - defaultEnd);
  const hours = extraMin / 60;
  return Math.round(hours * 4) / 4;
}

export const DEFAULT_SERVICE_CHECK_IN = '18:00';
export const DEFAULT_SERVICE_CHECK_OUT = '00:00';
