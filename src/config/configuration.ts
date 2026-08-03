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
      // Coma-separado: http://localhost:4200,http://192.168.0.2:3000
      origin: parseCorsOrigin(env.CORS_ORIGIN ?? 'http://localhost:4200'),
      credentials: true,
    },
  };
};

function parseCorsOrigin(raw: string): string | string[] | boolean {
  const value = String(raw || '').trim();
  if (!value || value === '*') return true;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length === 1) return parts[0];
  return parts;
}
