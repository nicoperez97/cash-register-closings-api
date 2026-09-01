import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import request from 'supertest';
import { PermissionsGuard } from '../src/common/guards';
import { ClosingsController } from '../src/modules/closings/closings.controller';
import { ClosingsService } from '../src/modules/closings/closings.service';
import { WhatsappImportService } from '../src/modules/closings/whatsapp-import.service';
import { ExcelImportService } from '../src/modules/closings/excel-import.service';
import { ReservationsController } from '../src/modules/reservations/reservations.controller';
import { ReservationsService } from '../src/modules/reservations/reservations.service';
import { ReservationRequestsService } from '../src/modules/reservations/reservation-requests.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { ProfileService } from '../src/modules/profile/profile.service';
import { bearerFor, TEST_SHOP_ID } from './fixtures/auth-users';
import { TestAuthGuard } from './helpers/test-auth.guard';

describe('Permisos HTTP (e2e)', () => {
  let app: INestApplication;
  const api = (path: string) => `/api/v1${path}`;

  const closingsService = {
    list: jest.fn().mockResolvedValue([]),
    one: jest.fn().mockResolvedValue({ id: 'c1' }),
    create: jest.fn().mockResolvedValue({ id: 'c-new' }),
  };

  const reservationsService = {
    listWaiting: jest.fn().mockResolvedValue([]),
    createWaiting: jest.fn().mockResolvedValue({ id: 'w1', guestName: 'Test' }),
    listReservations: jest.fn().mockResolvedValue([]),
  };

  const usersService = {
    list: jest.fn().mockResolvedValue([]),
    canManageUsersSomewhere: jest.fn().mockReturnValue(true),
    assertShopUserAdmin: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ClosingsController, ReservationsController, UsersController],
      providers: [
        PermissionsGuard,
        { provide: ClosingsService, useValue: closingsService },
        { provide: WhatsappImportService, useValue: {} },
        { provide: ExcelImportService, useValue: {} },
        { provide: ReservationsService, useValue: reservationsService },
        { provide: ReservationRequestsService, useValue: {} },
        { provide: UsersService, useValue: usersService },
        { provide: ProfileService, useValue: {} },
        { provide: APP_GUARD, useClass: TestAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useClass(TestAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    closingsService.list.mockResolvedValue([]);
    reservationsService.listWaiting.mockResolvedValue([]);
    usersService.list.mockResolvedValue([]);
  });

  describe('autenticación', () => {
    it('sin token → 401', async () => {
      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/closings`))
        .expect(401);
    });

    it('token inválido → 401', async () => {
      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/closings`))
        .set('Authorization', 'Bearer invalid')
        .expect(401);
    });
  });

  describe('cajero (solo cierres)', () => {
    const auth = bearerFor('cashier');

    it('GET /closings → 403', async () => {
      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/closings`))
        .set('Authorization', auth)
        .expect(403);

      expect(closingsService.list).not.toHaveBeenCalled();
    });

    it('GET /waiting-list → 403', async () => {
      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/waiting-list`))
        .set('Authorization', auth)
        .expect(403);

      expect(reservationsService.listWaiting).not.toHaveBeenCalled();
    });

    it('POST /waiting-list → 403', async () => {
      await request(app.getHttpServer())
        .post(api(`/shops/${TEST_SHOP_ID}/waiting-list`))
        .set('Authorization', auth)
        .send({ guestName: 'Juan', partySize: 2 })
        .expect(403);

      expect(reservationsService.createWaiting).not.toHaveBeenCalled();
    });

    it('GET /reservations → 403', async () => {
      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/reservations`))
        .set('Authorization', auth)
        .expect(403);
    });

    it('GET /users → 403', async () => {
      await request(app.getHttpServer())
        .get(api('/users'))
        .set('Authorization', auth)
        .expect(403);

      expect(usersService.list).not.toHaveBeenCalled();
    });

    it('GET /users/me-profile → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(api('/users/me-profile'))
        .set('Authorization', auth)
        .expect(200);

      expect(res.body.email).toBe('cashier@test.local');
    });
  });

  describe('recepcionista', () => {
    const auth = bearerFor('receptionist');

    it('GET /waiting-list → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/waiting-list`))
        .set('Authorization', auth)
        .expect(200);

      expect(res.body).toEqual([]);
      expect(reservationsService.listWaiting).toHaveBeenCalled();
    });

    it('POST /waiting-list → 201', async () => {
      await request(app.getHttpServer())
        .post(api(`/shops/${TEST_SHOP_ID}/waiting-list`))
        .set('Authorization', auth)
        .send({ guestName: 'María', partySize: 3 })
        .expect(201);

      expect(reservationsService.createWaiting).toHaveBeenCalled();
    });

    it('GET /closings → 403', async () => {
      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/closings`))
        .set('Authorization', auth)
        .expect(403);

      expect(closingsService.list).not.toHaveBeenCalled();
    });

    it('GET /users → 403', async () => {
      await request(app.getHttpServer())
        .get(api('/users'))
        .set('Authorization', auth)
        .expect(403);
    });
  });

  describe('admin', () => {
    const auth = bearerFor('admin');

    it('GET /users → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(api('/users'))
        .set('Authorization', auth)
        .expect(200);

      expect(res.body).toEqual([]);
      expect(usersService.list).toHaveBeenCalled();
    });

    it('GET /closings y /waiting-list → 200', async () => {
      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/closings`))
        .set('Authorization', auth)
        .expect(200);

      await request(app.getHttpServer())
        .get(api(`/shops/${TEST_SHOP_ID}/waiting-list`))
        .set('Authorization', auth)
        .expect(200);
    });
  });
});
