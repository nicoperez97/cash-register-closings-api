/** Retención de archivos subidos (comprobantes, facturas, adjuntos de cierre, CVs). */

export const DEFAULT_UPLOADS_RETENTION_DAYS = 365;
export const DEFAULT_UPLOADS_PURGE_CRON = '0 5 * * *';
export const DEFAULT_UPLOADS_PURGE_TZ = 'America/Argentina/Buenos_Aires';

/** Carpetas de documentos. Logos, avatares y cartas no se purgan. */
export const DOCUMENT_UPLOAD_FOLDERS = [
  'closings',
  'payments',
  'movements',
  'reimbursements',
  'orders',
  'candidates',
] as const;

export type UploadRetentionSettings = {
  /** 0 = no borrar nunca. */
  retentionDays: number;
  cron: string;
  timeZone: string;
};

export function parseUploadsRetentionDays(raw?: string | null): number {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return DEFAULT_UPLOADS_RETENTION_DAYS;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_UPLOADS_RETENTION_DAYS;
  return Math.floor(n);
}

export function parseUploadsPurgeCron(raw?: string | null): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return DEFAULT_UPLOADS_PURGE_CRON;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return DEFAULT_UPLOADS_PURGE_CRON;
  return trimmed;
}

export function parseUploadsPurgeTz(raw?: string | null): string {
  const trimmed = String(raw ?? '').trim();
  return trimmed || DEFAULT_UPLOADS_PURGE_TZ;
}

export function uploadRetentionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): UploadRetentionSettings {
  return {
    retentionDays: parseUploadsRetentionDays(env.UPLOADS_RETENTION_DAYS),
    cron: parseUploadsPurgeCron(env.UPLOADS_PURGE_CRON),
    timeZone: parseUploadsPurgeTz(env.UPLOADS_PURGE_TZ),
  };
}

export function uploadRetentionCutoff(now: Date, retentionDays: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff;
}
