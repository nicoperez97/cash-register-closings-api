import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, Repository } from 'typeorm';
import { isEntityActive } from '../../common/active.util';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { Employee } from '../../entities/employee.entity';
import { SalonMapObject } from '../../entities/salon-map-object.entity';
import { SalonSector } from '../../entities/salon-sector.entity';
import { SalonTable } from '../../entities/salon-table.entity';
import { Shop } from '../../entities/shop.entity';
import {
  TableSession,
  TableSessionStatus,
} from '../../entities/table-session.entity';
import { AuthUser } from '../../common/decorators';
import { CustomerOrdersService } from '../customer-orders/customer-orders.service';
import { PrintAgentService } from '../print-agent/print-agent.service';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { ShopsService } from '../shops/shops.service';
import {
  assertWaiterShopSlug,
  waiterEmployeeIdOrNull,
  WaiterAuthPayload,
} from './waiter-auth';

function hashPin(pin: string): string {
  return createHash('sha256').update(String(pin).trim()).digest('hex');
}

@Injectable()
export class WaiterService implements OnModuleInit {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(SalonTable) private readonly tables: Repository<SalonTable>,
    @InjectRepository(SalonSector) private readonly sectors: Repository<SalonSector>,
    @InjectRepository(SalonMapObject)
    private readonly mapObjects: Repository<SalonMapObject>,
    @InjectRepository(TableSession) private readonly sessions: Repository<TableSession>,
    @InjectRepository(CustomerOrder) private readonly orders: Repository<CustomerOrder>,
    private readonly jwt: JwtService,
    private readonly customerOrders: CustomerOrdersService,
    private readonly printAgent: PrintAgentService,
    private readonly live: ShopLiveService,
    private readonly shopsSvc: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.sessions.query(`
        CREATE TABLE IF NOT EXISTS table_sessions (
          id CHAR(36) NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          shopId CHAR(36) NOT NULL,
          salonTableId CHAR(36) NOT NULL,
          waiterEmployeeId CHAR(36) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
          covers INT NOT NULL DEFAULT 2,
          customerTicketPrinted TINYINT(1) NOT NULL DEFAULT 0,
          closedAt DATETIME(6) NULL,
          PRIMARY KEY (id),
          KEY idx_table_sessions_shop_status (shopId, status),
          KEY idx_table_sessions_table (salonTableId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch {
      // tabla ya existe / dialecto distinto
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN covers INT NOT NULL DEFAULT 2`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions MODIFY waiterEmployeeId CHAR(36) NULL`,
      );
    } catch {
      /* already nullable / dialect */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN customerTicketPrinted TINYINT(1) NOT NULL DEFAULT 0`,
      );
    } catch {
      /* already exists */
    }
  }

  private async requireShop(slug: string): Promise<Shop> {
    const shop = await this.shops.findOne({ where: { slug, active: true as any } });
    if (!shop) {
      throw new NotFoundException('Local no encontrado');
    }
    if (!shop.waiterOrderingEnabled) {
      throw new ForbiddenException(
        'Comanda de mozos no disponible. Activála en Configuración → Pedidos y guardá.',
      );
    }
    return shop;
  }

  /** Info pública del local para la pantalla de login (sin PIN). */
  async bootstrap(slug: string) {
    const shop = await this.requireShop(slug);
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
    };
  }

  async login(slug: string, pinRaw: string) {
    const shop = await this.requireShop(slug);
    const pin = String(pinRaw ?? '').trim();
    if (!/^\d{4,6}$/.test(pin)) {
      throw new UnauthorizedException('PIN incorrecto');
    }
    const hash = hashPin(pin);
    const employees = await this.employees.find({
      where: { shopId: shop.id, waiterPinHash: hash },
    });
    const employee = employees.find((e) => isEntityActive(e.active));
    if (!employee) throw new UnauthorizedException('PIN incorrecto');

    const token = await this.jwt.signAsync(
      {
        typ: 'waiter',
        shopId: shop.id,
        employeeId: employee.id,
        slug: shop.slug,
        name: employee.fullName,
      } satisfies WaiterAuthPayload,
      { expiresIn: '12h' },
    );
    return {
      token,
      waiter: { id: employee.id, fullName: employee.fullName },
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
    };
  }

  /**
   * Backoffice (Operación → Comanda): emite el mismo token de mapa/comanda
   * sin PIN, usando el usuario logueado.
   */
  async staffEnter(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId, active: true as any } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.waiterOrderingEnabled) {
      throw new ForbiddenException(
        'Comanda no disponible. Activála en Configuración → Pedidos y guardá.',
      );
    }

    const linked = (
      await this.employees.find({ where: { shopId: shop.id, userId: user.id } })
    ).filter((e) => isEntityActive(e.active));
    const employee =
      linked.find((e) => !!e.waiterPinHash) ?? linked[0] ?? null;

    const payload: WaiterAuthPayload = {
      typ: 'waiter_staff',
      shopId: shop.id,
      employeeId: employee?.id ?? '',
      slug: shop.slug,
      name: employee?.fullName ?? user.fullName ?? user.email,
    };
    const token = await this.jwt.signAsync(payload, { expiresIn: '12h' });
    return {
      token,
      waiter: {
        id: employee?.id ?? 'staff',
        fullName: payload.name,
      },
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
    };
  }

  async me(slug: string, waiter: WaiterAuthPayload) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    if (shop.id !== waiter.shopId) throw new UnauthorizedException();

    if (waiter.typ === 'waiter_staff') {
      const empId = waiterEmployeeIdOrNull(waiter);
      if (empId) {
        const employee = await this.employees.findOne({
          where: { id: empId, shopId: shop.id },
        });
        if (!employee || !isEntityActive(employee.active)) {
          throw new UnauthorizedException('Sesión inválida');
        }
        return {
          waiter: { id: employee.id, fullName: employee.fullName },
          shop: {
            id: shop.id,
            name: shop.name,
            slug: shop.slug,
            logoUrl: shop.logoUrl ?? null,
            accentColor: shop.accentColor ?? null,
          },
        };
      }
      return {
        waiter: { id: 'staff', fullName: waiter.name },
        shop: {
          id: shop.id,
          name: shop.name,
          slug: shop.slug,
          logoUrl: shop.logoUrl ?? null,
          accentColor: shop.accentColor ?? null,
        },
      };
    }

    const employee = await this.employees.findOne({
      where: { id: waiter.employeeId, shopId: shop.id },
    });
    if (!employee || !isEntityActive(employee.active) || !employee.waiterPinHash) {
      throw new UnauthorizedException('Sesión inválida');
    }
    return {
      waiter: { id: employee.id, fullName: employee.fullName },
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
    };
  }

  async catalog(slug: string, waiter: WaiterAuthPayload) {
    assertWaiterShopSlug(waiter, slug);
    return this.customerOrders.getWaiterOrderingConfig(slug);
  }

  async listTables(slug: string, waiter: WaiterAuthPayload) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const tables = (await this.tables.find({ where: { shopId: shop.id } }))
      .filter((t) => isEntityActive(t.active) && t.forWaiter !== false && Number(t.forWaiter) !== 0)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es'));
    const openSessions = await this.sessions.find({
      where: { shopId: shop.id, status: TableSessionStatus.OPEN },
    });
    const sessionIds = openSessions.map((s) => s.id);
    const orderCounts = new Map<string, number>();
    if (sessionIds.length) {
      const rows = await this.orders
        .createQueryBuilder('o')
        .select('o.tableSessionId', 'sid')
        .addSelect('COUNT(*)', 'cnt')
        .where('o.shopId = :shopId', { shopId: shop.id })
        .andWhere('o.tableSessionId IN (:...ids)', { ids: sessionIds })
        .groupBy('o.tableSessionId')
        .getRawMany<{ sid: string; cnt: string }>();
      for (const r of rows) {
        orderCounts.set(r.sid, Number(r.cnt) || 0);
      }
    }
    const byTable = new Map(openSessions.map((s) => [s.salonTableId, s]));
    const objectRows = (await this.mapObjects.find({ where: { shopId: shop.id } })).filter(
      (o) => isEntityActive(o.active),
    );
    const sectorIds = [
      ...new Set(
        [
          ...tables.map((t) => t.sectorId).filter(Boolean),
          ...objectRows.map((o) => o.sectorId).filter(Boolean),
        ] as string[],
      ),
    ];
    const sectorRows = sectorIds.length
      ? await this.sectors.find({ where: { id: In(sectorIds) } })
      : [];
    const sectorName = new Map(sectorRows.map((s) => [s.id, (s.name ?? '').trim() || 'Sector']));

    const tableDtos = tables.map((t) => {
      const session = byTable.get(t.id);
      const orderCount = session ? orderCounts.get(session.id) ?? 0 : 0;
      // Solo ocupa si ya hubo al menos un envío.
      const occupied = !!session && orderCount > 0;
      const sid = t.sectorId ?? null;
      return {
        id: t.id,
        sectorId: sid,
        sectorName: sid ? sectorName.get(sid) ?? 'Sector' : t.area === 'OUTSIDE' ? 'Afuera' : 'Adentro',
        area: t.area,
        label: t.label,
        seats: t.seats,
        sortOrder: t.sortOrder,
        mapX: t.mapX == null ? null : Number(t.mapX),
        mapY: t.mapY == null ? null : Number(t.mapY),
        openSession: occupied && session
          ? {
              id: session.id,
              waiterEmployeeId: session.waiterEmployeeId,
              openedAt: session.createdAt,
              covers: Number(session.covers) || 2,
              orderCount,
              customerTicketPrinted: !!session.customerTicketPrinted,
            }
          : null,
      };
    });

    return {
      tables: tableDtos,
      mapObjects: objectRows
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((o) => ({
          id: o.id,
          sectorId: o.sectorId,
          kind: o.kind,
          name: (o.name ?? '').trim() || o.kind,
          mapX: Number(o.mapX),
          mapY: Number(o.mapY),
        })),
    };
  }

  async openSession(
    slug: string,
    waiter: WaiterAuthPayload,
    salonTableId: string,
    coversRaw: number,
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const covers = Math.round(Number(coversRaw));
    if (!Number.isFinite(covers) || covers < 1 || covers > 30) {
      throw new BadRequestException('Indicá entre 1 y 30 comensales');
    }
    const table = await this.tables.findOne({
      where: { id: salonTableId, shopId: shop.id },
    });
    if (!table || !isEntityActive(table.active)) {
      throw new NotFoundException('Mesa no encontrada');
    }
    const existing = await this.sessions.findOne({
      where: {
        shopId: shop.id,
        salonTableId: table.id,
        status: TableSessionStatus.OPEN,
      },
    });
    if (existing) {
      const orderCount = await this.orders.count({
        where: { shopId: shop.id, tableSessionId: existing.id },
      });
      if (orderCount > 0) {
        return this.sessionDetail(shop, existing);
      }
      existing.covers = covers;
      existing.waiterEmployeeId = waiterEmployeeIdOrNull(waiter);
      await this.sessions.save(existing);
      return this.sessionDetail(shop, existing);
    }
    const row = await this.sessions.save(
      this.sessions.create({
        shopId: shop.id,
        salonTableId: table.id,
        waiterEmployeeId: waiterEmployeeIdOrNull(waiter),
        status: TableSessionStatus.OPEN,
        covers,
        customerTicketPrinted: false,
        closedAt: null,
        active: true,
      }),
    );
    return this.sessionDetail(shop, row);
  }

  async getSession(slug: string, waiter: WaiterAuthPayload, sessionId: string) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    return this.sessionDetail(shop, session);
  }

  /** Descarta una sesión sin envíos (la mesa sigue libre). */
  async discardSession(slug: string, waiter: WaiterAuthPayload, sessionId: string) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) return { ok: true };
    const orderCount = await this.orders.count({
      where: { shopId: shop.id, tableSessionId: session.id },
    });
    if (orderCount > 0) {
      throw new BadRequestException('La mesa ya tiene envíos; cerrala en lugar de descartar');
    }
    if (session.status === TableSessionStatus.OPEN) {
      session.status = TableSessionStatus.CLOSED;
      session.closedAt = new Date();
      await this.sessions.save(session);
    }
    return { ok: true };
  }

  async createSessionOrder(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
    dto: {
      items: Array<{
        menuItemId: string;
        qty: number;
        notes?: string | null;
        removedIngredients?: string[];
      }>;
      extras?: Array<{
        extraId: string;
        qty: number;
        attachedToMenuItemId?: string | null;
      }>;
      customerNotes?: string | null;
      printKitchen?: boolean;
      printCustomerTicket?: boolean;
    },
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status !== TableSessionStatus.OPEN) {
      throw new BadRequestException('La mesa ya está cerrada');
    }
    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    if (!table) throw new NotFoundException('Mesa no encontrada');

    const printKitchen = dto.printKitchen !== false;
    const printCustomerTicket = !!dto.printCustomerTicket;
    if (!printKitchen && !printCustomerTicket) {
      throw new BadRequestException('Elegí imprimir cocina y/o ticket cliente');
    }

    const order = await this.customerOrders.createTableOrder(shop, {
      items: dto.items ?? [],
      extras: dto.extras,
      customerNotes: dto.customerNotes,
      salonTableId: table.id,
      tableSessionId: session.id,
      waiterEmployeeId: waiterEmployeeIdOrNull(waiter),
      tableLabel: table.label,
      waiterName: waiter.name,
      printKitchen,
      printCustomerTicket,
    });

    if (printCustomerTicket && !session.customerTicketPrinted) {
      session.customerTicketPrinted = true;
      await this.sessions.save(session);
    }
    this.live.tick(shop.id, 'customer-orders');
    return order;
  }

  async closeSession(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
    opts?: { printCustomerTicket?: boolean },
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status === TableSessionStatus.CLOSED) {
      return this.sessionDetail(shop, session);
    }

    const orders = await this.orders.find({
      where: { shopId: shop.id, tableSessionId: session.id },
      order: { createdAt: 'DESC' },
    });
    if (!orders.length) {
      session.status = TableSessionStatus.CLOSED;
      session.closedAt = new Date();
      await this.sessions.save(session);
      return this.sessionDetail(shop, session);
    }

    if (opts?.printCustomerTicket) {
      const last = orders[0];
      const table = await this.tables.findOne({
        where: { id: session.salonTableId, shopId: shop.id },
      });
      await this.printAgent
        .enqueueCustomerOrder(shop, last, 'TABLE', {
          printKitchen: false,
          printCustomerTicket: true,
          tableLabel: table?.label ?? null,
          waiterName: waiter.name,
          customerSourceSuffix: 'close',
        })
        .catch(() => undefined);
      session.customerTicketPrinted = true;
    }

    session.status = TableSessionStatus.CLOSED;
    session.closedAt = new Date();
    await this.sessions.save(session);
    this.live.tick(shop.id, 'customer-orders');
    return this.sessionDetail(shop, session);
  }

  /** Imprime ticket cliente sin cerrar la mesa. */
  async printCustomerTicket(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status === TableSessionStatus.CLOSED) {
      throw new BadRequestException('La mesa ya está cerrada');
    }
    const orders = await this.orders.find({
      where: { shopId: shop.id, tableSessionId: session.id },
      order: { createdAt: 'DESC' },
    });
    if (!orders.length) {
      throw new BadRequestException('No hay envíos para imprimir');
    }
    const last = orders[0];
    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    await this.printAgent
      .enqueueCustomerOrder(shop, last, 'TABLE', {
        printKitchen: false,
        printCustomerTicket: true,
        tableLabel: table?.label ?? null,
        waiterName: waiter.name,
        customerSourceSuffix: 'ticket',
      })
      .catch(() => undefined);
    session.customerTicketPrinted = true;
    await this.sessions.save(session);
    this.live.tick(shop.id, 'customer-orders');
    return this.sessionDetail(shop, session);
  }

  private async sessionDetail(shop: Shop, session: TableSession) {
    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    const waiterEmp = session.waiterEmployeeId
      ? await this.employees.findOne({
          where: { id: session.waiterEmployeeId, shopId: shop.id },
        })
      : null;
    const orders = await this.orders.find({
      where: { shopId: shop.id, tableSessionId: session.id },
      order: { createdAt: 'ASC' },
    });
    return {
      id: session.id,
      status: session.status,
      covers: Number(session.covers) || 2,
      customerTicketPrinted: !!session.customerTicketPrinted,
      orderCount: orders.length,
      openedAt: session.createdAt,
      closedAt: session.closedAt ?? null,
      table: table
        ? {
            id: table.id,
            label: table.label,
            area: table.area,
            seats: table.seats,
          }
        : null,
      waiter: waiterEmp
        ? { id: waiterEmp.id, fullName: waiterEmp.fullName }
        : session.waiterEmployeeId
          ? { id: session.waiterEmployeeId, fullName: '—' }
          : { id: '', fullName: 'Cliente' },
      orders: orders.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        fulfillment: o.fulfillment,
        items: o.items ?? [],
        subtotal: Number(o.subtotal),
        total: Number(o.total),
        customerNotes: o.customerNotes ?? null,
        createdAt: o.createdAt,
      })),
    };
  }
}
