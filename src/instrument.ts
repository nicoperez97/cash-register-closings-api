import * as Sentry from '@sentry/nestjs';

/**
 * Sentry opcional: solo con SENTRY_DSN. Se importa antes que todo en main.ts
 * para que la instrumentación enganche Express / mysql2.
 */
const dsn = (process.env.SENTRY_DSN ?? '').trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0') || 0,
    // La API maneja datos de clientes, empleados y plata: por defecto Sentry 11 junta
    // headers, cookies, query y bodies; acá solo el stack y la ruta.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}
