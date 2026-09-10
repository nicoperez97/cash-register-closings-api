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
import { In, Repository } from 'typeorm';
import { isEntityActive } from '../../common/active.util';
import { ShopMode, normalizeShopMode } from '../../common/shop-ordering';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { SalonMapObject } from '../../entities/salon-map-object.entity';
import { SalonSector } from '../../entities/salon-sector.entity';
import { SalonTable } from '../../entities/salon-table.entity';
import { Shop } from '../../entities/shop.entity';
import {
  TableSession,
  TableSessionStatus,
} from '../../entities/table-session.entity';
import { CustomerOrdersService } from '../customer-orders/customer-orders.service';
import { ShopLiveService } from '../shop-live/shop-live.service';
import {
  assertDineInShopSlug,
  DineInAuthPayload,
} from './dine-in-auth';

@Injectable()
export class DineInService implements OnModuleInit {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(SalonTable) private readonly tables: Repository<SalonTable>,
    @InjectRepository(SalonSector) private readonly sectors: Repository<SalonSector>,
    @InjectRepository(SalonMapObject)
    private readonly mapObjects: Repository<SalonMapObject>,
    @InjectRepository(TableSession) private readonly sessions: Repository<TableSession>,
    @InjectRepository(CustomerOrder) private readonly orders: Repository<CustomerOrder>,
    private readonly jwt: JwtService,
    private readonly customerOrders: CustomerOrdersService,
    private readonly live: ShopLiveService,
  ) {}

  async onModuleInit() {
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions MODIFY waiterEmployeeId CHAR(36) NULL`,
      );
    } catch {
      /* dialect / already nullable */
    }
  }

  private async requireShop(slug: string): Promise<Shop> {
    const shop = await this.shops.findOne({ where: { slug, active: true as any } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.onlineOrderingEnabled) {
      throw new ForbiddenException('Pedidos online no disponibles');
    }
    if (normalizeShopMode(shop.shopMode) !== ShopMode.RESTAURANTE) {
      throw new ForbiddenException(
        'Pedido en mesa solo está disponible en locales tipo restaurante',
      );
    }
    if (shop.orderingForceClosed) {
      throw new ForbiddenException('El local está cerrado para pedidos online');
    }
    return shop;
  }

  private async issueToken(shop: Shop, session: TableSession): Promise<string> {
    return this.jwt.signAsync(
      {
        typ: 'dine_in',
        shopId: shop.id,
        slug: shop.slug,
        tableSessionId: session.id,
        salonTableId: session.salonTableId,
      } satisfies DineInAuthPayload,
      { expiresIn: '12h' },
    );
  }

  async getFloor(slug: string) {
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

    const sectorIds = [
      ...new Set(
        [
          ...tables.map((t) => t.sectorId).filter(Boolean),
          ...(await this.mapObjects.find({ where: { shopId: shop.id } }))
            .filter((o) => isEntityActive(o.active))
            .map((o) => o.sectorId),
        ] as string[],
      ),
    ];
    const sectorRows = sectorIds.length
      ? await this.sectors.find({ where: { id: In(sectorIds) } })
      : [];
    const sectorName = new Map(
      sectorRows
        .filter((s) => isEntityActive(s.active))
        .map((s) => [s.id, (s.name ?? '').trim() || 'Sector']),
    );

    const objects = (await this.mapObjects.find({ where: { shopId: shop.id } }))
      .filter((o) => isEntityActive(o.active))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const tableDtos = tables.map((t) => {
      const session = byTable.get(t.id);
      const orderCount = session ? orderCounts.get(session.id) ?? 0 : 0;
      const occupied = !!session && orderCount > 0;
      const sid = t.sectorId ?? null;
      return {
        id: t.id,
        sectorId: sid,
        sectorName: sid
          ? sectorName.get(sid) ?? 'Sector'
          : t.area === 'OUTSIDE'
            ? 'Afuera'
            : 'Adentro',
        area: t.area,
        label: t.label,
        seats: t.seats,
        sortOrder: t.sortOrder,
        mapX: t.mapX == null ? null : Number(t.mapX),
        mapY: t.mapY == null ? null : Number(t.mapY),
        occupied,
        covers: occupied && session ? Number(session.covers) || 2 : null,
        orderCount: occupied ? orderCount : 0,
      };
    });

    const sectors = [...sectorName.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    // Sectores solo referenciados por mesas/objetos sin fila de sector
    for (const t of tableDtos) {
      if (t.sectorId && !sectors.some((s) => s.id === t.sectorId)) {
        sectors.push({ id: t.sectorId, name: t.sectorName });
      }
    }

    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
        accentSecondary: shop.accentSecondary ?? null,
        currency: shop.currency || 'ARS',
      },
      sectors,
      tables: tableDtos,
      mapObjects: objects.map((o) => ({
        id: o.id,
        sectorId: o.sectorId,
        kind: o.kind,
        name: (o.name ?? '').trim() || o.kind,
        mapX: Number(o.mapX),
        mapY: Number(o.mapY),
      })),
    };
  }

  async openSession(slug: string, salonTableId: string, coversRaw: number) {
    const shop = await this.requireShop(slug);
    const covers = Math.round(Number(coversRaw));
    if (!Number.isFinite(covers) || covers < 1 || covers > 30) {
      throw new BadRequestException('Indicá entre 1 y 30 comensales');
    }
    const table = await this.tables.findOne({
      where: { id: salonTableId, shopId: shop.id },
    });
    if (
      !table ||
      !isEntityActive(table.active) ||
      table.forWaiter === false ||
      Number(table.forWaiter) === 0
    ) {
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
        throw new BadRequestException('Esa mesa ya está ocupada');
      }
      existing.covers = covers;
      existing.waiterEmployeeId = null as any;
      await this.sessions.save(existing);
      const token = await this.issueToken(shop, existing);
      return {
        token,
        session: await this.sessionDetail(shop, existing),
      };
    }

    const row = await this.sessions.save(
      this.sessions.create({
        shopId: shop.id,
        salonTableId: table.id,
        waiterEmployeeId: null as any,
        status: TableSessionStatus.OPEN,
        covers,
        customerTicketPrinted: false,
        closedAt: null,
        active: true,
      }),
    );
    const token = await this.issueToken(shop, row);
    return {
      token,
      session: await this.sessionDetail(shop, row),
    };
  }

  async resumeSession(slug: string, guest: DineInAuthPayload) {
    assertDineInShopSlug(guest, slug);
    const shop = await this.requireShop(slug);
    if (shop.id !== guest.shopId) throw new UnauthorizedException();
    const session = await this.sessions.findOne({
      where: { id: guest.tableSessionId, shopId: shop.id },
    });
    if (!session || session.status !== TableSessionStatus.OPEN) {
      throw new NotFoundException('Sesión no encontrada');
    }
    return this.sessionDetail(shop, session);
  }

  async discardSession(slug: string, guest: DineInAuthPayload) {
    assertDineInShopSlug(guest, slug);
    const shop = await this.requireShop(slug);
    const session = await this.sessions.findOne({
      where: { id: guest.tableSessionId, shopId: shop.id },
    });
    if (!session) return { ok: true };
    const orderCount = await this.orders.count({
      where: { shopId: shop.id, tableSessionId: session.id },
    });
    if (orderCount > 0) {
      throw new BadRequestException('La mesa ya tiene envíos; pedile al mozo que la cierre');
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
    guest: DineInAuthPayload,
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
    },
  ) {
    assertDineInShopSlug(guest, slug);
    const shop = await this.requireShop(slug);
    const session = await this.sessions.findOne({
      where: { id: guest.tableSessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status !== TableSessionStatus.OPEN) {
      throw new BadRequestException('La mesa ya está cerrada');
    }
    if (session.salonTableId !== guest.salonTableId) {
      throw new UnauthorizedException('Sesión inválida');
    }
    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    if (!table) throw new NotFoundException('Mesa no encontrada');

    const order = await this.customerOrders.createTableOrder(shop, {
      items: dto.items ?? [],
      extras: dto.extras,
      customerNotes: dto.customerNotes,
      salonTableId: table.id,
      tableSessionId: session.id,
      waiterEmployeeId: null,
      tableLabel: table.label,
      waiterName: 'Cliente',
      printKitchen: dto.printKitchen !== false,
      printCustomerTicket: false,
      response: 'guest',
    });

    this.live.tick(shop.id, 'customer-orders');
    return order;
  }

  private async sessionDetail(shop: Shop, session: TableSession) {
    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    const orders = await this.orders.find({
      where: { shopId: shop.id, tableSessionId: session.id },
      order: { createdAt: 'ASC' },
    });
    return {
      id: session.id,
      status: session.status,
      covers: Number(session.covers) || 2,
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
