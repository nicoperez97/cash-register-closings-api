export const DEFAULT_PUBLIC_TIME_SLOTS = ['19:30', '20:00', '20:30', '21:00'];

export const DEFAULT_PUBLIC_GENERAL_MESSAGE =
  'Se toman reservas hasta las 21 hs. A partir de las 21 hs es por orden de llegada.';

export type ReservationPublicFormConfig = {
  hoursByWeekday?: Record<string, string[]>;
  generalMessage?: string | null;
  weekdayMessages?: Record<string, string>;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeTimeSlot(raw: unknown): string | null {
  const t = String(raw ?? '').trim();
  if (!TIME_RE.test(t)) return null;
  return t;
}

export function normalizeHoursList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const t = normalizeTimeSlot(item);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  out.sort();
  return out.slice(0, 24);
}

export function normalizePublicFormConfig(raw: unknown): ReservationPublicFormConfig {
  const src =
    raw && typeof raw === 'object' ? (raw as ReservationPublicFormConfig) : {};
  const hoursByWeekday: Record<string, string[]> = {};
  const weekdayMessages: Record<string, string> = {};
  for (let d = 0; d <= 6; d++) {
    const key = String(d);
    hoursByWeekday[key] = normalizeHoursList(
      src.hoursByWeekday?.[key] ?? (src.hoursByWeekday as Record<number, string[]> | undefined)?.[d],
    );
    const msg = String(src.weekdayMessages?.[key] ?? '').trim().slice(0, 400);
    if (msg) weekdayMessages[key] = msg;
  }
  const generalMessage = String(src.generalMessage ?? '').trim().slice(0, 600);
  return { hoursByWeekday, generalMessage, weekdayMessages };
}

export function defaultPublicFormConfig(): ReservationPublicFormConfig {
  const hoursByWeekday: Record<string, string[]> = {};
  for (let d = 0; d <= 6; d++) {
    hoursByWeekday[String(d)] = [...DEFAULT_PUBLIC_TIME_SLOTS];
  }
  return {
    hoursByWeekday,
    generalMessage: DEFAULT_PUBLIC_GENERAL_MESSAGE,
    weekdayMessages: {},
  };
}

export function storedOrDefaultPublicForm(
  raw: unknown,
): ReservationPublicFormConfig {
  if (raw == null) return defaultPublicFormConfig();
  return normalizePublicFormConfig(raw);
}

export function weekdayFromIsoDate(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? '').slice(0, 10));
  if (!m) return 0;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)).getUTCDay();
}

export function resolvePublicFormForWeekday(
  raw: unknown,
  weekday: number,
): {
  timeSlots: string[];
  generalMessage: string | null;
  weekdayMessage: string | null;
} {
  const stored = raw == null ? defaultPublicFormConfig() : normalizePublicFormConfig(raw);
  const key = String(weekday);
  const timeSlots = stored.hoursByWeekday?.[key] ?? [];
  const generalMessage = String(stored.generalMessage ?? '').trim() || null;
  const weekdayMessage = String(stored.weekdayMessages?.[key] ?? '').trim() || null;
  return { timeSlots, generalMessage, weekdayMessage };
}
