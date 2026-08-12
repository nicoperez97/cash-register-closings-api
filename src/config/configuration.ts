export default () => {
  const env = process.env;
  const isProd = (env.NODE_ENV ?? 'development') === 'production';
  const jwtSecret = env.JWT_SECRET ?? 'change-me-crc-dev';
  if (isProd && (!env.JWT_SECRET || env.JWT_SECRET === 'change-me-crc-dev')) {
    throw new Error('JWT_SECRET debe configurarse en production');
  }
  return {
    environment: env.NODE_ENV ?? 'development',
    api: {
      port: parseInt(env.PORT ?? '3000', 10),
      secret: jwtSecret,
    },
    database: {
      type: 'mysql' as const,
      host: env.DB_HOST ?? 'localhost',
      port: parseInt(env.DB_PORT ?? '3306', 10),
      database: env.DB_NAME ?? 'cash_register_closings',
      username: env.DB_USER ?? 'root',
      password: env.DB_PASSWORD ?? 'root',
      synchronize: (env.DB_SYNC ?? (isProd ? 'false' : 'true')) === 'true',
      autoLoadEntities: true,
    },
    cors: {
      // Coma-separado: localhost + CloudFront + dominio custom
      origin: parseCorsOrigin(env.CORS_ORIGIN ?? 'http://localhost:4200'),
      credentials: true,
    },
    /** Origen canónico del front (links en mails / deep links push). */
    publicAppOrigin: (
      env.PUBLIC_APP_ORIGIN ??
      'https://cierres.perezcompany.com.ar'
    ).trim(),
    webPush: {
      publicKey: (env.VAPID_PUBLIC_KEY ?? '').trim(),
      privateKey: (env.VAPID_PRIVATE_KEY ?? '').trim(),
      // mailto: o https: — si no hay mail fijo, usar la URL pública de la app
      subject: (
        env.VAPID_SUBJECT ??
        env.PUBLIC_APP_ORIGIN ??
        'https://cierres.perezcompany.com.ar'
      ).trim(),
    },
    /** Secreto para webhook de deploy (broadcast push de nueva versión). */
    deployWebhookSecret: (env.DEPLOY_WEBHOOK_SECRET ?? '').trim(),
    smtp: {
      host: (env.SMTP_HOST ?? '').trim(),
      port: parseInt(env.SMTP_PORT ?? '587', 10),
      secure: (env.SMTP_SECURE ?? 'false') === 'true',
      user: (env.SMTP_USER ?? '').trim(),
      pass: (env.SMTP_PASS ?? '').trim(),
      /** Remitente por defecto si el local no tiene email. */
      from: (env.SMTP_FROM ?? env.SMTP_USER ?? '').trim(),
    },
  };
};

function parseCorsOrigin(raw: string): string | string[] | boolean {
  const value = String(raw || '').trim();
  if (!value || value === '*') return true;
  const parts = value
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length === 1) return parts[0];
  return parts;
}
