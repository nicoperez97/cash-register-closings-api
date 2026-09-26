import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * e2e contra una base MySQL real (arranca AppModule con DB_SYNC + seed demo).
 *
 * Se ejecuta solo con E2E_DB=1 para no romper `npm test` en entornos sin DB:
 *   E2E_DB=1 DB_NAME=cash_register_closings_test npx jest test/app-db.e2e-spec.ts
 *
 * Requiere una base vacía accesible (por defecto cash_register_closings_test en
 * 127.0.0.1:3306, root/root). El seed crea admin/manager/cashier @cierres.com
 * (password demo) y los locales Al Panino / Tutto Passa.
 */
const RUN = process.env.E2E_DB === '1';
const describeDb = RUN ? describe : describe.skip;

const PANINO = '11111111-1111-1111-1111-111111111111';

describeDb('App e2e (DB real)', () => {
  let app: INestApplication;
  const api = (p: string) => `/api/v1${p}`;

  beforeAll(async () => {
    process.env.DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
    process.env.DB_PORT = process.env.DB_PORT ?? '3306';
    process.env.DB_USER = process.env.DB_USER ?? 'root';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? 'root';
    process.env.DB_NAME = process.env.DB_NAME ?? 'cash_register_closings_test';
    process.env.DB_SYNC = 'true';
    process.env.ENABLE_DEMO_SEED = 'true';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-secret';

    // Import dinámico: recién acá, con el env ya seteado, se resuelve la config.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  }, 180000);

  afterAll(async () => {
    await app?.close();
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post(api('/auth/login')).send({ email, password });

  const tokenFor = async (email: string): Promise<string> => {
    const res = await login(email, 'demo');
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  };

  it('rechaza login con password incorrecta', async () => {
    const res = await login('admin@cierres.com', 'nope');
    expect(res.status).toBe(401);
  });

  it('login admin devuelve token OWNER y /auth/me funciona', async () => {
    const res = await login('admin@cierres.com', 'demo');
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.globalRole).toBe('OWNER');

    const me = await request(app.getHttpServer())
      .get(api('/auth/me'))
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('admin@cierres.com');
  });

  it('rechaza endpoint protegido sin token (401)', async () => {
    const res = await request(app.getHttpServer()).get(api('/shops/mine'));
    expect(res.status).toBe(401);
  });

  it('admin ve sus locales y el listado de cierres', async () => {
    const token = await tokenFor('admin@cierres.com');
    const auth = { Authorization: `Bearer ${token}` };

    const mine = await request(app.getHttpServer()).get(api('/shops/mine')).set(auth);
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.body)).toBe(true);
    expect(mine.body.length).toBeGreaterThanOrEqual(2);

    const closings = await request(app.getHttpServer())
      .get(api(`/shops/${PANINO}/closings`))
      .set(auth);
    expect(closings.status).toBe(200);
    expect(Array.isArray(closings.body)).toBe(true);
  });

  it('cashier accede a su local pero no al panel de super admin', async () => {
    const token = await tokenFor('cashier@cierres.com');
    const auth = { Authorization: `Bearer ${token}` };

    const mine = await request(app.getHttpServer()).get(api('/shops/mine')).set(auth);
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.body)).toBe(true);

    // Catálogo global de instaladores: solo super admin.
    const adminOnly = await request(app.getHttpServer())
      .get(api('/admin/print-agent-installer'))
      .set(auth);
    expect([401, 403]).toContain(adminOnly.status);
  });
});
