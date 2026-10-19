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

  /**
   * Rollback real: se fuerza un error a mitad del flujo (después de escribir el cierre o
   * el claim del pago) y se verifica en MySQL que no quedó nada a medias.
   */
  describe('transacciones de plata (rollback en MySQL)', () => {
    const marker = `rollback-e2e-${Date.now()}`;
    const count = async (sql: string, params: unknown[]): Promise<number> => {
      const { DataSource } = await import('typeorm');
      const rows: Array<{ c: number | string }> = await app.get(DataSource).query(sql, params);
      return Number(rows?.[0]?.c ?? 0);
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('cierre: si falla el sync de movimientos no queda ni el cierre ni sus gastos/extras', async () => {
      const { ClosingMovementsSyncService } =
        await import('../src/modules/movements/closing-movements-sync.service');
      const sync = app.get(ClosingMovementsSyncService);
      const token = await tokenFor('admin@cierres.com');
      const auth = { Authorization: `Bearer ${token}` };
      // Fecha fija y vieja: no choca con datos del seed.
      const businessDate = '2001-02-03';
      const liveClosings = () =>
        count(
          'SELECT COUNT(*) AS c FROM cash_closings WHERE shopId = ? AND businessDate = ? AND active = 1 AND deletedAt IS NULL',
          [PANINO, businessDate],
        );
      expect(await liveClosings()).toBe(0);

      const body = {
        businessDate,
        posSystemAmount: 1000,
        cashAmount: 1000,
        expenses: [{ label: `${marker}-gasto`, amount: 50 }],
        extraLines: [{ type: 'OTHER', label: `${marker}-extra`, amount: 20 }],
      };
      jest.spyOn(sync, 'syncFromClosing').mockRejectedValueOnce(new Error('forced sync failure'));
      const failed = await request(app.getHttpServer())
        .post(api(`/shops/${PANINO}/closings`))
        .set(auth)
        .send(body);
      expect(failed.status).toBeGreaterThanOrEqual(500);

      expect(await liveClosings()).toBe(0);
      expect(
        await count('SELECT COUNT(*) AS c FROM closing_expenses WHERE label = ?', [
          `${marker}-gasto`,
        ]),
      ).toBe(0);
      expect(
        await count('SELECT COUNT(*) AS c FROM closing_extra_lines WHERE label = ?', [
          `${marker}-extra`,
        ]),
      ).toBe(0);

      // Control: sin el error, el mismo cierre sí se guarda (el test no es vacuo).
      const ok = await request(app.getHttpServer())
        .post(api(`/shops/${PANINO}/closings`))
        .set(auth)
        .send(body);
      expect(ok.status).toBe(201);
      expect(await liveClosings()).toBe(1);
      expect(
        await count('SELECT COUNT(*) AS c FROM closing_expenses WHERE closingId = ?', [ok.body.id]),
      ).toBe(1);

      // Limpieza (soft delete + baja de hijos y asientos) para poder re-correr.
      const del = await request(app.getHttpServer())
        .delete(api(`/shops/${PANINO}/closings/${ok.body.id}`))
        .set(auth);
      expect(del.status).toBe(200);
      expect(await liveClosings()).toBe(0);
    });

    it('pago: si falla el egreso, el pago sigue VALIDATED y sin movimiento', async () => {
      const { DataSource } = await import('typeorm');
      const { MovementsService } = await import('../src/modules/movements/movements.service');
      const { Payment } = await import('../src/entities/payment.entity');
      const { PaymentMethod, PaymentStatus } = await import('../src/common/enums');
      const ds = app.get(DataSource);
      const token = await tokenFor('admin@cierres.com');
      const auth = { Authorization: `Bearer ${token}` };

      const [account] = (await ds.query(
        "SELECT id FROM ledger_accounts WHERE shopId = ? AND active = 1 AND type <> 'SYSTEM' AND deletedAt IS NULL ORDER BY name LIMIT 1",
        [PANINO],
      )) as Array<{ id: string }>;
      expect(account?.id).toBeTruthy();

      const payments = ds.getRepository(Payment);
      const payment = await payments.save(
        payments.create({
          shopId: PANINO,
          title: `${marker}-pago`,
          amount: '123.00',
          accountId: account.id,
          paymentMethod: PaymentMethod.CASH,
          status: PaymentStatus.VALIDATED,
          validatedAt: new Date(),
          active: true,
        }),
      );

      jest
        .spyOn(app.get(MovementsService), 'create')
        .mockRejectedValueOnce(new Error('forced movement failure'));
      const failed = await request(app.getHttpServer())
        .post(api(`/shops/${PANINO}/payments/${payment.id}/pay`))
        .set(auth)
        .send({ paidAt: '2001-02-03', accountId: account.id, paymentMethod: 'cash' });
      expect(failed.status).toBeGreaterThanOrEqual(500);

      const after = await payments.findOne({ where: { id: payment.id } });
      expect(after?.status).toBe(PaymentStatus.VALIDATED);
      expect(after?.movementId ?? null).toBeNull();
      expect(after?.paidAt ?? null).toBeNull();
      // Ni el saldo pendiente de un parcial ni un egreso suelto.
      expect(
        await count('SELECT COUNT(*) AS c FROM payments WHERE title = ? AND active = 1', [
          `${marker}-pago`,
        ]),
      ).toBe(1);
      expect(
        await count('SELECT COUNT(*) AS c FROM movements WHERE description LIKE ?', [
          `%${marker}-pago%`,
        ]),
      ).toBe(0);

      await payments.softRemove(after!);
    });
  });
});
