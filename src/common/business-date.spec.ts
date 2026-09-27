import { resolveShopCalendarDate, shopNowHhMm } from './business-date';

describe('business-date · shopNowHhMm / resolveShopCalendarDate', () => {
  // 2026-09-27 00:26 UTC → en AR (UTC-3) es 2026-09-26 21:26.
  const utc = new Date('2026-09-27T00:26:00Z');
  const AR = 'America/Argentina/Buenos_Aires';

  it('shopNowHhMm devuelve la hora wall-clock del timezone', () => {
    expect(shopNowHhMm(AR, utc)).toBe('21:26');
    expect(shopNowHhMm('UTC', utc)).toBe('00:26');
  });

  it('resolveShopCalendarDate usa el día calendario del timezone', () => {
    // En AR todavía es el 26; en UTC ya es 27.
    expect(resolveShopCalendarDate(utc, { timezone: AR })).toBe('2026-09-26');
    expect(resolveShopCalendarDate(utc, { timezone: 'UTC' })).toBe('2026-09-27');
  });

  it('el filtro de turnos pasados (hoy) mantiene sólo los > hora actual', () => {
    // Reproduce la lógica de futureSlotsForDate para la hora AR (21:26).
    const now = shopNowHhMm(AR, utc);
    const slots = ['12:00', '20:00', '22:00', '23:30'];
    expect(slots.filter((s) => s > now)).toEqual(['22:00', '23:30']);
  });
});
