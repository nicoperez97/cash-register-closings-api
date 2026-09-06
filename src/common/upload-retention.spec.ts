import {
  DEFAULT_UPLOADS_PURGE_CRON,
  DEFAULT_UPLOADS_PURGE_TZ,
  DEFAULT_UPLOADS_RETENTION_DAYS,
  parseUploadsPurgeCron,
  parseUploadsPurgeTz,
  parseUploadsRetentionDays,
  uploadRetentionCutoff,
  uploadRetentionFromEnv,
} from './upload-retention';

describe('upload-retention', () => {
  it('usa 365 días si no hay env', () => {
    expect(parseUploadsRetentionDays(undefined)).toBe(DEFAULT_UPLOADS_RETENTION_DAYS);
    expect(parseUploadsRetentionDays('')).toBe(365);
  });

  it('acepta 0 para desactivar la purga', () => {
    expect(parseUploadsRetentionDays('0')).toBe(0);
  });

  it('rechaza valores inválidos', () => {
    expect(parseUploadsRetentionDays('-1')).toBe(365);
    expect(parseUploadsRetentionDays('nope')).toBe(365);
  });

  it('valida el cron de 5 o 6 campos', () => {
    expect(parseUploadsPurgeCron('30 6 * * *')).toBe('30 6 * * *');
    expect(parseUploadsPurgeCron('0 0 4 * * *')).toBe('0 0 4 * * *');
    expect(parseUploadsPurgeCron('mal')).toBe(DEFAULT_UPLOADS_PURGE_CRON);
    expect(parseUploadsPurgeCron('')).toBe(DEFAULT_UPLOADS_PURGE_CRON);
  });

  it('usa timezone de Argentina por defecto', () => {
    expect(parseUploadsPurgeTz('')).toBe(DEFAULT_UPLOADS_PURGE_TZ);
    expect(parseUploadsPurgeTz('UTC')).toBe('UTC');
  });

  it('arma el corte restando días', () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    expect(uploadRetentionCutoff(now, 365).toISOString()).toBe('2025-09-05T12:00:00.000Z');
  });

  it('lee el env completo', () => {
    expect(
      uploadRetentionFromEnv({
        UPLOADS_RETENTION_DAYS: '180',
        UPLOADS_PURGE_CRON: '15 4 * * *',
        UPLOADS_PURGE_TZ: 'UTC',
      }),
    ).toEqual({
      retentionDays: 180,
      cron: '15 4 * * *',
      timeZone: 'UTC',
    });
  });
});
