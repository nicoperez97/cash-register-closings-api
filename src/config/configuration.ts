export default () => {
  const env = process.env;
  return {
    environment: env.NODE_ENV ?? 'development',
    api: {
      port: parseInt(env.PORT ?? '3000', 10),
      secret: env.JWT_SECRET ?? 'change-me-crc-dev',
    },
    database: {
      type: 'mysql' as const,
      host: env.DB_HOST ?? 'localhost',
      port: parseInt(env.DB_PORT ?? '3306', 10),
      database: env.DB_NAME ?? 'cash_register_closings',
      username: env.DB_USER ?? 'root',
      password: env.DB_PASSWORD ?? 'root',
      synchronize: (env.DB_SYNC ?? 'true') === 'true',
      autoLoadEntities: true,
    },
    cors: {
      origin: env.CORS_ORIGIN ?? 'http://localhost:4200',
      credentials: true,
    },
  };
};
