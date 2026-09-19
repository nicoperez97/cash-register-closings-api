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
import { And, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { isEntityActive } from '../../common/active.util';
import {
  ComandaLineAudit,
  type ComandaLineAuditAction,
  type ComandaLineAuditRelated,
} from '../../entities/comanda-line-audit.entity';
import { CustomerOrder, CustomerOrderLine } from '../../entities/customer-order.entity';
import { Employee, EmployeeJobRole, normalizeEmployeeJobRoles } from '../../entities/employee.entity';
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
import {
  normalizeTablePaymentMethods,
  resolveWaiterCapProfile,
  type WaiterCapProfile,
} from '../../common/shop-ordering';
import {
  autoAssignPromosAtOpen,
  computeMultiPromoBreakdown,
  normalizeSessionPromos,
  normalizeShopPromos,
  type PromoBreakdown,
  type SessionPromoAssignment,
} from '../../common/shop-promos';
import {
  normalizeShopShifts,
  resolveCurrentShift,
  shopShiftOwnershipRangeUtc,
  type ShopShift,
} from '../../common/shop-shifts';
import { resolveShopBusinessDate } from '../../common/business-date';

function hashPin(pin: string): string {
  return createHash('sha256').update(String(pin).trim()).digest('hex');
}

function calcTicketDiscount(
  subtotal: number,
  mode?: string | null,
  value?: number | null,
): { discountAmount: number; discountLabel: string | null } {
  const sub = Math.max(0, Number(subtotal) || 0);
  const m = String(mode || 'none').toLowerCase();
  const v = Math.max(0, Number(value) || 0);
  if (m === 'percent' && v > 0) {
    const pct = Math.min(100, v);
    const amount = Math.round(((sub * pct) / 100) * 100) / 100;
    return { discountAmount: amount, discountLabel: `${pct}%` };
  }
  if (m === 'fixed' && v > 0) {
    const amount = Math.min(sub, Math.round(v * 100) / 100);
    return { discountAmount: amount, discountLabel: 'Desc.' };
  }
  return { discountAmount: 0, discountLabel: null };
}

function calcTip(
  base: number,
  mode?: string | null,
  value?: number | null,
): { tipAmount: number; tipLabel: string | null } {
  const sub = Math.max(0, Number(base) || 0);
  const m = String(mode || 'none').toLowerCase();
  const v = Math.max(0, Number(value) || 0);
  if (m === 'percent' && v > 0) {
    const pct = Math.min(100, v);
    const amount = Math.round(((sub * pct) / 100) * 100) / 100;
    return { tipAmount: amount, tipLabel: `${pct}%` };
  }
  if ((m === 'fixed' || m === 'amount') && v > 0) {
    const amount = Math.round(v * 100) / 100;
    return { tipAmount: amount, tipLabel: 'Propina' };
  }
  return { tipAmount: 0, tipLabel: null };
}

function nearlyEqual(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol;
}

function isExtraLine(line: CustomerOrderLine): boolean {
  return String(line.kind || '').toUpperCase() === 'EXTRA';
}

/** Índices de extras agrupados bajo el ítem en `itemIdx` (mismo criterio que la UI). */
function pairedExtraIndices(items: CustomerOrderLine[], itemIdx: number): number[] {
  const target = items[itemIdx];
  if (!target || isExtraLine(target)) return [];
  const targetId = String(target.menuItemId || '').trim();
  if (!targetId) return [];

  const mains: number[] = [];
  const extras: number[] = [];
  items.forEach((l, i) => {
    if (isExtraLine(l)) extras.push(i);
    else mains.push(i);
  });
  const used = new Set<number>();
  for (const mi of mains) {
    const id = String(items[mi].menuItemId || '').trim();
    const group: number[] = [];
    for (const ei of extras) {
      if (used.has(ei)) continue;
      const parent = String(items[ei].attachedToMenuItemId || '').trim();
      if (!parent || !id || parent !== id) continue;
      used.add(ei);
      group.push(ei);
    }
    if (mi === itemIdx) return group;
  }
  return [];
}

function money2(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function snapshotLine(line: CustomerOrderLine): Record<string, unknown> {
  return {
    menuItemId: line.menuItemId,
    name: line.name,
    qty: Number(line.qty) || 0,
    unitPrice: Number(line.unitPrice) || 0,
    kind: line.kind ?? 'ITEM',
    notes: line.notes ?? null,
    extraId: line.extraId ?? null,
    attachedToMenuItemId: line.attachedToMenuItemId ?? null,
    isEntrada: !!line.isEntrada,
  };
}

function relatedFromLine(
  line: CustomerOrderLine,
  extra?: { qtyAfter?: number | null; unitPriceAfter?: number | null },
): ComandaLineAuditRelated {
  return {
    name: line.name,
    qty: Number(line.qty) || 0,
    unitPrice: Number(line.unitPrice) || 0,
    kind: line.kind ?? 'ITEM',
    qtyAfter: extra?.qtyAfter ?? null,
    unitPriceAfter: extra?.unitPriceAfter ?? null,
  };
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
    @InjectRepository(ComandaLineAudit)
    private readonly lineAudits: Repository<ComandaLineAudit>,
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
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN ticketDiscountAmount DECIMAL(12,2) NOT NULL DEFAULT 0`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN ticketDiscountLabel VARCHAR(80) NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN ticketTotal DECIMAL(12,2) NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN paymentMethodId VARCHAR(40) NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN paymentMethodName VARCHAR(80) NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN paymentAccountId CHAR(36) NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN payments JSON NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN tipAmount DECIMAL(12,2) NOT NULL DEFAULT 0`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN tipLabel VARCHAR(80) NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN promoId VARCHAR(40) NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN promoMaxCount INT NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(
        `ALTER TABLE table_sessions ADD COLUMN sessionPromos JSON NULL`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.sessions.query(`
        CREATE TABLE IF NOT EXISTS comanda_line_audits (
          id CHAR(36) NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          shopId CHAR(36) NOT NULL,
          tableSessionId CHAR(36) NOT NULL,
          salonTableId CHAR(36) NULL,
          tableLabel VARCHAR(64) NULL,
          customerOrderId CHAR(36) NULL,
          orderCode VARCHAR(12) NOT NULL,
          action VARCHAR(16) NOT NULL,
          lineIndex INT NOT NULL,
          itemName VARCHAR(200) NOT NULL,
          lineKind VARCHAR(16) NOT NULL DEFAULT 'ITEM',
          qtyBefore INT NULL,
          qtyAfter INT NULL,
          unitPriceBefore DECIMAL(12,2) NULL,
          unitPriceAfter DECIMAL(12,2) NULL,
          relatedLines TEXT NULL,
          lineBefore TEXT NULL,
          actorTyp VARCHAR(24) NOT NULL,
          actorEmployeeId CHAR(36) NULL,
          actorName VARCHAR(120) NOT NULL,
          orderRemoved TINYINT(1) NOT NULL DEFAULT 0,
          PRIMARY KEY (id),
          KEY idx_comanda_audits_session (shopId, tableSessionId, createdAt),
          KEY idx_comanda_audits_shop_created (shopId, createdAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch {
      /* tabla ya existe / dialecto distinto */
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
      capabilities: resolveWaiterCapProfile(shop.waiterCapabilities, 'waiter'),
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
      capabilities: this.caps(shop, payload),
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
          capabilities: this.caps(shop, waiter),
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
        capabilities: this.caps(shop, waiter),
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
      capabilities: this.caps(shop, waiter),
    };
  }

  async catalog(slug: string, waiter: WaiterAuthPayload) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const cfg = await this.customerOrders.getWaiterOrderingConfig(slug);
    return {
      ...cfg,
      capabilities: this.caps(shop, waiter),
    };
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

  private caps(shop: Shop, waiter: WaiterAuthPayload): WaiterCapProfile {
    return resolveWaiterCapProfile(shop.waiterCapabilities, waiter.typ);
  }

  private denyUnless(ok: boolean, message: string): void {
    if (!ok) throw new ForbiddenException(message);
  }

  /**
   * Mozos elegibles al abrir mesa desde Operación → Comanda.
   * Prioriza rol Mozo o PIN; si no hay, lista activos.
   */
  async listStaffWaiters(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopAccess(user, shopId);
    const rows = (
      await this.employees.find({
        where: { shopId },
        order: { fullName: 'ASC' },
      })
    ).filter((e) => isEntityActive(e.active));

    const isWaiterLike = (e: Employee) => {
      const roles = normalizeEmployeeJobRoles(e.jobRoles);
      return roles.includes(EmployeeJobRole.WAITER) || !!e.waiterPinHash;
    };

    const preferred = rows.filter(isWaiterLike);
    const list = preferred.length ? preferred : rows;
    return list.map((e) => ({ id: e.id, fullName: e.fullName }));
  }

  /** Tablero de monitoreo staff: mesas abiertas, últimos envíos y cambios del turno. */
  async staffMonitor(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId, active: true as any } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.waiterOrderingEnabled) {
      throw new ForbiddenException(
        'Comanda no disponible. Activála en Configuración → Pedidos y guardá.',
      );
    }

    const shifts = normalizeShopShifts(shop.shifts as ShopShift[] | null, shop.openingTime);
    const businessDate = resolveShopBusinessDate(new Date(), {
      timezone: shop.timezone,
      openingTime: shop.openingTime,
    });
    const shift = resolveCurrentShift(shifts, new Date(), shop.timezone);
    const ownership = shopShiftOwnershipRangeUtc(businessDate, shift, shifts, {
      timezone: shop.timezone,
    });

    const openSessions = await this.sessions.find({
      where: { shopId: shop.id, status: TableSessionStatus.OPEN },
      order: { createdAt: 'ASC' },
    });
    const sessionIds = openSessions.map((s) => s.id);
    const orders = sessionIds.length
      ? await this.orders.find({
          where: { shopId: shop.id, tableSessionId: In(sessionIds) },
          order: { createdAt: 'DESC' },
        })
      : [];
    const ordersBySession = new Map<string, CustomerOrder[]>();
    for (const o of orders) {
      const sid = String(o.tableSessionId ?? '');
      if (!sid) continue;
      const list = ordersBySession.get(sid) ?? [];
      list.push(o);
      ordersBySession.set(sid, list);
    }

    const tableIds = [...new Set(openSessions.map((s) => s.salonTableId))];
    const tables = tableIds.length
      ? await this.tables.find({ where: { shopId: shop.id, id: In(tableIds) } })
      : [];
    const tableById = new Map(tables.map((t) => [t.id, t]));
    const sectorIds = [
      ...new Set(tables.map((t) => t.sectorId).filter(Boolean) as string[]),
    ];
    const sectors = sectorIds.length
      ? await this.sectors.find({ where: { id: In(sectorIds) } })
      : [];
    const sectorName = new Map(
      sectors.map((s) => [s.id, (s.name ?? '').trim() || 'Sector']),
    );
    const waiterIds = [
      ...new Set(
        openSessions
          .map((s) => s.waiterEmployeeId)
          .filter((id): id is string => !!String(id ?? '').trim()),
      ),
    ];
    const waiters = waiterIds.length
      ? await this.employees.find({ where: { shopId: shop.id, id: In(waiterIds) } })
      : [];
    const waiterName = new Map(waiters.map((e) => [e.id, e.fullName]));

    const compactLines = (items: CustomerOrderLine[], max = 14) => {
      const rows: Array<{ qty: number; name: string; extra: boolean }> = [];
      for (const l of items ?? []) {
        rows.push({
          qty: Number(l.qty) || 0,
          name: l.name,
          extra: String(l.kind || '').toUpperCase() === 'EXTRA',
        });
        if (rows.length >= max) break;
      }
      return rows;
    };

    const tableDtos = openSessions
      .map((session) => {
        const sessionOrders = ordersBySession.get(session.id) ?? [];
        if (!sessionOrders.length) return null;
        const table = tableById.get(session.salonTableId);
        const sid = table?.sectorId ?? null;
        const newest = sessionOrders[0];
        const oldestFirst = [...sessionOrders].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
        const lines: Array<{ qty: number; name: string; extra: boolean }> = [];
        for (const o of oldestFirst) {
          for (const row of compactLines(o.items ?? [], 40)) {
            lines.push(row);
            if (lines.length >= 16) break;
          }
          if (lines.length >= 16) break;
        }
        const total = sessionOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
        return {
          sessionId: session.id,
          tableId: session.salonTableId,
          tableLabel: table?.label ?? 'Mesa',
          sectorName: sid
            ? sectorName.get(sid) ?? 'Sector'
            : table?.area === 'OUTSIDE'
              ? 'Afuera'
              : 'Adentro',
          covers: Number(session.covers) || 2,
          waiterName:
            (session.waiterEmployeeId && waiterName.get(session.waiterEmployeeId)) ||
            '—',
          openedAt: session.createdAt,
          orderCount: sessionOrders.length,
          customerTicketPrinted: !!session.customerTicketPrinted,
          lastOrderAt: newest?.createdAt ?? session.createdAt,
          lastOrderCode: newest?.code ?? null,
          total: Math.round(total * 100) / 100,
          lines,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row);

    const recentOrders = orders.slice(0, 20).map((o) => {
      const session = openSessions.find((s) => s.id === o.tableSessionId);
      const table = session ? tableById.get(session.salonTableId) : null;
      return {
        id: o.id,
        code: o.code,
        tableLabel: table?.label ?? 'Mesa',
        waiterName:
          (session?.waiterEmployeeId && waiterName.get(session.waiterEmployeeId)) ||
          '—',
        createdAt: o.createdAt,
        total: Number(o.total) || 0,
        items: compactLines(o.items ?? [], 8),
      };
    });

    const audits = await this.lineAudits.find({
      where: {
        shopId: shop.id,
        createdAt: And(MoreThanOrEqual(ownership.from), LessThan(ownership.to)),
      },
      order: { createdAt: 'DESC' },
      take: 80,
    });

    return {
      shopName: shop.name,
      shiftName: shift?.name ?? null,
      tables: tableDtos,
      recentOrders,
      recentAudits: audits.map((a) => ({
        id: a.id,
        action: a.action,
        orderCode: a.orderCode,
        itemName: a.itemName,
        lineKind: a.lineKind,
        qtyBefore: a.qtyBefore,
        qtyAfter: a.qtyAfter,
        unitPriceBefore:
          a.unitPriceBefore == null ? null : Number(a.unitPriceBefore) || 0,
        unitPriceAfter:
          a.unitPriceAfter == null ? null : Number(a.unitPriceAfter) || 0,
        relatedLines: a.relatedLines ?? [],
        actorName: a.actorName,
        actorTyp: a.actorTyp,
        orderRemoved: !!a.orderRemoved,
        createdAt: a.createdAt,
        tableLabel: a.tableLabel ?? null,
      })),
    };
  }

  async openSession(
    slug: string,
    waiter: WaiterAuthPayload,
    salonTableId: string,
    coversRaw: number,
    waiterEmployeeIdRaw?: string | null,
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

    let waiterEmployeeId = waiterEmployeeIdOrNull(waiter);
    if (waiter.typ === 'waiter_staff') {
      const caps = this.caps(shop, waiter);
      const override = String(waiterEmployeeIdRaw ?? '').trim();
      if (caps.requireWaiterOnOpen && !override) {
        throw new BadRequestException('Elegí el mozo a cargo');
      }
      if (override) {
        const emp = await this.employees.findOne({
          where: { id: override, shopId: shop.id },
        });
        if (!emp || !isEntityActive(emp.active)) {
          throw new BadRequestException('Mozo no válido');
        }
        waiterEmployeeId = emp.id;
      }
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
      existing.waiterEmployeeId = waiterEmployeeId;
      await this.sessions.save(existing);
      return this.sessionDetail(shop, existing);
    }
    const row = await this.sessions.save(
      this.sessions.create({
        shopId: shop.id,
        salonTableId: table.id,
        waiterEmployeeId,
        status: TableSessionStatus.OPEN,
        covers,
        customerTicketPrinted: false,
        closedAt: null,
        active: true,
      }),
    );

    const auto = autoAssignPromosAtOpen(
      normalizeShopPromos(shop.promos),
      new Date(),
      shop.timezone,
    );
    if (auto.length) {
      this.applySessionPromos(
        row,
        auto.map((p) => ({ promoId: p.id, maxCount: null })),
      );
      await this.sessions.save(row);
    }

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
    // Sesiones vacías siempre se pueden limpiar (el mapa las oculta y ensucian el cierre).
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
      items?: Array<{
        menuItemId: string;
        qty: number;
        notes?: string | null;
        removedIngredients?: string[];
        isEntrada?: boolean;
        combinesWithNames?: string[];
      }>;
      extras?: Array<{
        extraId: string;
        qty: number;
        attachedToMenuItemId?: string | null;
      }>;
      promos?: Array<{ promoId: string; qty: number }>;
      customerNotes?: string | null;
      printKitchen?: boolean;
      printCustomerTicket?: boolean;
    },
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const caps = this.caps(shop, waiter);
    this.denyUnless(caps.allowSendOrder, 'No está permitido enviar comandas');
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

    let printKitchen = !!dto.printKitchen;
    let printCustomerTicket = !!dto.printCustomerTicket;
    if (caps.lockPrintKitchen || dto.printKitchen === undefined) {
      printKitchen = caps.allowPrintKitchen && caps.defaultPrintKitchen;
    }
    if (caps.lockPrintCustomerTicket || dto.printCustomerTicket === undefined) {
      printCustomerTicket =
        caps.allowPrintCustomerTicket && caps.defaultPrintCustomerTicket;
    }
    if (!caps.allowPrintKitchen) printKitchen = false;
    if (!caps.allowPrintCustomerTicket) printCustomerTicket = false;
    // Se puede agregar a la mesa sin imprimir (sin cocina ni ticket).

    const sessionWaiterId = session.waiterEmployeeId ?? waiterEmployeeIdOrNull(waiter);
    const sessionWaiter = sessionWaiterId
      ? await this.employees.findOne({
          where: { id: sessionWaiterId, shopId: shop.id },
        })
      : null;
    const waiterName = sessionWaiter?.fullName?.trim() || waiter.name;

    const order = await this.customerOrders.createTableOrder(shop, {
      items: dto.items ?? [],
      extras: dto.extras,
      promos: dto.promos,
      customerNotes: dto.customerNotes,
      salonTableId: table.id,
      tableSessionId: session.id,
      waiterEmployeeId: sessionWaiterId,
      tableLabel: table.label,
      waiterName,
      printKitchen,
      printCustomerTicket,
    });

    // Sellables con composición: asegurar promo en la mesa para el matching.
    if (dto.promos?.length) {
      const catalog = normalizeShopPromos(shop.promos);
      const byId = new Map(catalog.map((p) => [p.id, p] as const));
      const current = this.readSessionPromos(session);
      const seen = new Set(current.map((p) => p.promoId));
      let changed = false;
      for (const sale of dto.promos) {
        const promo = byId.get(String(sale.promoId ?? '').trim());
        if (!promo?.tableMatchable || !promo.items.length || !promo.available) continue;
        if (seen.has(promo.id)) continue;
        current.push({ promoId: promo.id, maxCount: null });
        seen.add(promo.id);
        changed = true;
      }
      if (changed) {
        this.applySessionPromos(session, current);
        await this.sessions.save(session);
      }
    }

    // El ticket de sesión (con total/promos) se marca solo en printCustomerTicket().
    // No usar el flag del envío: imprimir ticket por orden no fija ticketTotal.
    this.live.tick(shop.id, 'customer-orders');
    return order;
  }

  async reprintSessionKitchen(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
    orderId: string,
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const caps = this.caps(shop, waiter);
    this.denyUnless(caps.allowPrintKitchen, 'No está permitido imprimir cocina');
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    const order = await this.orders.findOne({
      where: { id: orderId, shopId: shop.id, tableSessionId: session.id },
    });
    if (!order) throw new NotFoundException('Envío no encontrado');
    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    const sessionWaiter = session.waiterEmployeeId
      ? await this.employees.findOne({
          where: { id: session.waiterEmployeeId, shopId: shop.id },
        })
      : null;
    const result = await this.printAgent.reprintKitchenForOrder(shop, order, {
      reason: 'TABLE',
      tableLabel: table?.label ?? null,
      waiterName: sessionWaiter?.fullName?.trim() || waiter.name,
    });
    return { ok: true, ...result };
  }

  /** Asigna promos matchables (multi) y cupo por promo a la mesa. */
  async patchSessionPromo(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
    dto: {
      promoId?: string | null;
      promoMaxCount?: number | null;
      promos?: Array<{ promoId: string; maxCount?: number | null }> | null;
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

    const catalog = normalizeShopPromos(shop.promos);
    const byId = new Map(catalog.map((p) => [p.id, p] as const));
    let next: SessionPromoAssignment[];

    if (dto.promos !== undefined) {
      next = normalizeSessionPromos(dto.promos);
    } else {
      // Compat: un solo promoId / cupo.
      next = normalizeSessionPromos(session.sessionPromos, {
        promoId: session.promoId,
        promoMaxCount: session.promoMaxCount,
      });
      if (dto.promoId !== undefined) {
        const id = String(dto.promoId ?? '').trim();
        if (!id) {
          next = [];
        } else {
          const existing = next.find((p) => p.promoId === id);
          const max =
            dto.promoMaxCount !== undefined
              ? dto.promoMaxCount == null
                ? null
                : Math.round(Number(dto.promoMaxCount))
              : existing?.maxCount ?? null;
          const maxCount =
            max != null && Number.isFinite(max) && max >= 0 ? Math.min(999, max) : null;
          next = [{ promoId: id, maxCount }, ...next.filter((p) => p.promoId !== id)];
        }
      } else if (dto.promoMaxCount !== undefined && next.length === 1) {
        const max =
          dto.promoMaxCount == null ? null : Math.round(Number(dto.promoMaxCount));
        next = [
          {
            promoId: next[0].promoId,
            maxCount:
              max != null && Number.isFinite(max) && max >= 0 ? Math.min(999, max) : null,
          },
        ];
      }
    }

    for (const a of next) {
      const promo = byId.get(a.promoId);
      if (!promo || !promo.available || !promo.tableMatchable) {
        throw new BadRequestException(`Promo no disponible para mesa: ${a.promoId}`);
      }
      if (a.maxCount != null && (!Number.isFinite(a.maxCount) || a.maxCount < 1 || a.maxCount > 999)) {
        throw new BadRequestException('Cupo inválido (1–999 o ilimitado)');
      }
    }

    this.applySessionPromos(session, next);

    if (session.customerTicketPrinted) {
      session.customerTicketPrinted = false;
      session.ticketTotal = null;
      session.ticketDiscountAmount = '0';
      session.ticketDiscountLabel = null;
    }
    await this.sessions.save(session);
    this.live.tick(shop.id, 'customer-orders');
    return this.sessionDetail(shop, session);
  }

  /** Persiste multi-promo y sincroniza columnas legacy. */
  private applySessionPromos(session: TableSession, list: SessionPromoAssignment[]): void {
    session.sessionPromos = list.length ? list : null;
    session.promoId = list[0]?.promoId ?? null;
    session.promoMaxCount = list[0] ? list[0].maxCount : null;
  }

  private readSessionPromos(session: TableSession): SessionPromoAssignment[] {
    return normalizeSessionPromos(session.sessionPromos, {
      promoId: session.promoId,
      promoMaxCount: session.promoMaxCount,
    });
  }


  /** Ajusta cantidad, precio o quita una línea del ticket (antes de imprimir/cerrar). */
  async patchSessionLine(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
    dto: {
      orderId: string;
      lineIndex: number;
      qty?: number | null;
      unitPrice?: number | null;
      remove?: boolean;
    },
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const caps = this.caps(shop, waiter);
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status !== TableSessionStatus.OPEN) {
      throw new BadRequestException('La mesa ya está cerrada');
    }

    const order = await this.orders.findOne({
      where: { id: dto.orderId, shopId: shop.id, tableSessionId: session.id },
    });
    if (!order) throw new NotFoundException('Envío no encontrado');

    const items = [...(order.items ?? [])];
    const idx = Number(dto.lineIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
      throw new BadRequestException('Línea inválida');
    }

    const line = items[idx];
    const lineBefore = snapshotLine(line);
    const remove = !!dto.remove || (dto.qty != null && Number(dto.qty) <= 0);
    const hasQty = dto.qty != null && Number.isFinite(Number(dto.qty));
    if (remove) {
      this.denyUnless(caps.allowRemoveTicketLines, 'No está permitido quitar ítems del ticket');
    } else {
      this.denyUnless(caps.allowEditTicket, 'No está permitido modificar el ticket');
    }
    const hasPrice = dto.unitPrice != null && Number.isFinite(Number(dto.unitPrice));

    if (!remove && !hasQty && !hasPrice) {
      throw new BadRequestException('Nada para actualizar');
    }

    const qtyBefore = Math.max(0, Math.floor(Number(line.qty) || 0));
    const priceBefore = Math.max(0, Math.round((Number(line.unitPrice) || 0) * 100) / 100);
    const qtyAfter = remove
      ? 0
      : hasQty
        ? Math.max(1, Math.min(99, Math.floor(Number(dto.qty))))
        : qtyBefore;
    const priceAfter = remove
      ? priceBefore
      : hasPrice
        ? Math.max(0, Math.round(Number(dto.unitPrice) * 100) / 100)
        : priceBefore;
    if (!remove && qtyAfter === qtyBefore && nearlyEqual(priceAfter, priceBefore)) {
      throw new BadRequestException('Nada para actualizar');
    }

    const pairedIdx = !isExtraLine(line) ? pairedExtraIndices(items, idx) : [];
    let action: ComandaLineAuditAction = 'EDIT';
    if (remove) action = 'REMOVE';
    else if (qtyAfter !== qtyBefore && nearlyEqual(priceAfter, priceBefore)) action = 'QTY';
    else if (qtyAfter === qtyBefore && !nearlyEqual(priceAfter, priceBefore)) action = 'PRICE';

    const relatedLines: ComandaLineAuditRelated[] =
      pairedIdx.length && (remove || (hasQty && qtyAfter !== qtyBefore))
        ? pairedIdx.map((ei) =>
            relatedFromLine(items[ei], {
              qtyAfter: remove ? 0 : qtyAfter,
              unitPriceAfter: Number(items[ei].unitPrice) || 0,
            }),
          )
        : [];

    let next = items;
    let orderRemoved = false;
    if (remove) {
      const toRemove = new Set<number>([idx, ...pairedIdx]);
      next = items.filter((_, i) => !toRemove.has(i));
      orderRemoved = !next.length;
      if (orderRemoved) {
        await this.orders.remove(order);
      } else {
        order.items = next;
        this.recalcOrderTotals(order);
        await this.orders.save(order);
      }
    } else {
      if (hasPrice) line.unitPrice = priceAfter;
      if (hasQty) {
        line.qty = qtyAfter;
        for (const ei of pairedIdx) items[ei].qty = qtyAfter;
      }
      items[idx] = line;
      order.items = items;
      this.recalcOrderTotals(order);
      await this.orders.save(order);
    }

    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    await this.lineAudits.save(
      this.lineAudits.create({
        shopId: shop.id,
        tableSessionId: session.id,
        salonTableId: session.salonTableId,
        tableLabel: table?.label ?? null,
        customerOrderId: order.id,
        orderCode: order.code,
        action,
        lineIndex: idx,
        itemName: line.name,
        lineKind: line.kind ?? 'ITEM',
        qtyBefore,
        qtyAfter: remove ? 0 : qtyAfter,
        unitPriceBefore: money2(priceBefore),
        unitPriceAfter: money2(remove ? priceBefore : priceAfter),
        relatedLines: relatedLines.length ? relatedLines : null,
        lineBefore,
        actorTyp: waiter.typ,
        actorEmployeeId: waiterEmployeeIdOrNull(waiter),
        actorName: String(waiter.name ?? '').trim() || '—',
        orderRemoved,
      }),
    );

    if (session.customerTicketPrinted) {
      session.customerTicketPrinted = false;
      session.ticketDiscountAmount = '0';
      session.ticketDiscountLabel = null;
      session.ticketTotal = null;
      await this.sessions.save(session);
    }

    this.live.tick(shop.id, 'customer-orders');
    return this.sessionDetail(shop, session);
  }

  private recalcOrderTotals(order: CustomerOrder): void {
    const subtotal = (order.items ?? []).reduce(
      (s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0),
      0,
    );
    const discount = Math.min(subtotal, Number(order.discountAmount ?? 0) || 0);
    const fee = Number(order.deliveryFee ?? 0) || 0;
    const total = Math.max(0, Math.round((subtotal - discount + fee) * 100) / 100);
    order.subtotal = money2(subtotal);
    order.discountAmount = money2(discount);
    order.total = money2(total);
  }

  async closeSession(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
    opts?: {
      paymentMethodId?: string | null;
      payments?: Array<{ paymentMethodId: string; amount: number }> | null;
      tipMode?: string | null;
      tipValue?: number | null;
    },
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const caps = this.caps(shop, waiter);
    this.denyUnless(caps.allowCloseTable, 'No está permitido cerrar mesas');
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

    if (caps.requireTicketBeforeClose && !session.customerTicketPrinted) {
      throw new BadRequestException('Primero imprimí el ticket del cliente');
    }

    const methods = normalizeTablePaymentMethods(shop.tablePaymentMethods).filter(
      (m) => m.active !== false,
    );
    const methodById = new Map(methods.map((m) => [m.id, m]));

    // Con ticket de sesión usamos ese total (incl. descuento). Sin ticket, breakdown
    // de promos de mesa — nunca la suma cruda de order.total (precios de carta).
    const { sessionSubtotal } = this.resolveSessionPromo(shop, session, orders);
    const due =
      session.ticketTotal != null
        ? Number(session.ticketTotal) || 0
        : sessionSubtotal;
    const tipMode = caps.allowTipOnClose ? opts?.tipMode : 'none';
    const tipValue = caps.allowTipOnClose ? opts?.tipValue : null;
    const { tipAmount, tipLabel } = calcTip(due, tipMode, tipValue);
    const toCollect = Math.round((due + tipAmount) * 100) / 100;

    let rawPayments = (opts?.payments ?? [])
      .map((p) => ({
        paymentMethodId: String(p.paymentMethodId ?? '').trim(),
        amount: Math.round((Number(p.amount) || 0) * 100) / 100,
      }))
      .filter((p) => p.paymentMethodId && p.amount > 0);

    // Compat: un solo medio sin montos.
    if (!rawPayments.length && opts?.paymentMethodId) {
      rawPayments = [
        {
          paymentMethodId: String(opts.paymentMethodId).trim(),
          amount: toCollect,
        },
      ];
    }

    if (!rawPayments.length) {
      throw new BadRequestException('Indicá al menos una forma de pago con monto');
    }

    const payments: Array<{
      paymentMethodId: string;
      paymentMethodName: string;
      paymentAccountId: string | null;
      amount: number;
    }> = [];
    for (const row of rawPayments) {
      const method = methodById.get(row.paymentMethodId);
      if (!method) {
        throw new BadRequestException(`Medio de pago inválido: ${row.paymentMethodId}`);
      }
      payments.push({
        paymentMethodId: method.id,
        paymentMethodName: method.name,
        paymentAccountId: method.accountId ?? null,
        amount: row.amount,
      });
    }

    const paid = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    if (!nearlyEqual(paid, toCollect)) {
      throw new BadRequestException(
        `La suma de pagos ($${paid.toFixed(2)}) debe ser $${toCollect.toFixed(2)}`,
      );
    }

    const primary = [...payments].sort((a, b) => b.amount - a.amount)[0];
    session.payments = payments;
    session.paymentMethodId = primary.paymentMethodId;
    session.paymentMethodName = primary.paymentMethodName;
    session.paymentAccountId = primary.paymentAccountId;
    session.tipAmount = money2(tipAmount);
    session.tipLabel = tipLabel;
    session.status = TableSessionStatus.CLOSED;
    session.closedAt = new Date();
    await this.sessions.save(session);
    this.live.tick(shop.id, 'customer-orders');
    return this.sessionDetail(shop, session);
  }

  /** Propinas de mesas cerradas en el turno vigente. */
  async shiftTipsSummary(slug: string, waiter: WaiterAuthPayload) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    this.denyUnless(this.caps(shop, waiter).allowHistory, 'Historial no disponible');
    const shifts = normalizeShopShifts(shop.shifts as ShopShift[] | null, shop.openingTime);
    const businessDate = resolveShopBusinessDate(new Date(), {
      timezone: shop.timezone,
      openingTime: shop.openingTime,
    });
    const shift = resolveCurrentShift(shifts, new Date(), shop.timezone);
    const ownership = shopShiftOwnershipRangeUtc(businessDate, shift, shifts, {
      timezone: shop.timezone,
    });

    const closed = await this.sessions.find({
      where: {
        shopId: shop.id,
        status: TableSessionStatus.CLOSED,
        closedAt: And(MoreThanOrEqual(ownership.from), LessThan(ownership.to)),
      },
      order: { closedAt: 'DESC' },
      take: 500,
    });

    const tableIds = [...new Set(closed.map((s) => s.salonTableId))];
    const tables = tableIds.length
      ? await this.tables.find({ where: { shopId: shop.id, id: In(tableIds) } })
      : [];
    const tableLabel = new Map(tables.map((t) => [t.id, t.label]));

    const sessionIds = closed.map((s) => s.id);
    const orderSumBySession = new Map<string, number>();
    if (sessionIds.length) {
      const raw = await this.orders
        .createQueryBuilder('o')
        .select('o.tableSessionId', 'sid')
        .addSelect('COALESCE(SUM(o.total), 0)', 'total')
        .where('o.shopId = :shopId', { shopId: shop.id })
        .andWhere('o.tableSessionId IN (:...ids)', { ids: sessionIds })
        .groupBy('o.tableSessionId')
        .getRawMany<{ sid: string; total: string }>();
      for (const row of raw) {
        orderSumBySession.set(String(row.sid), Number(row.total) || 0);
      }
    }

    const parsePayments = (raw: unknown): Array<{
      paymentMethodId: string;
      paymentMethodName: string;
      amount: number;
    }> => {
      let list = raw;
      if (typeof list === 'string') {
        try {
          list = JSON.parse(list);
        } catch {
          return [];
        }
      }
      if (!Array.isArray(list)) return [];
      return list
        .map((p) => {
          const row = p as {
            paymentMethodId?: string;
            paymentMethodName?: string;
            amount?: number;
          };
          return {
            paymentMethodId: String(row.paymentMethodId ?? '').trim(),
            paymentMethodName: String(row.paymentMethodName ?? 'Pago').trim() || 'Pago',
            amount: Math.round((Number(row.amount) || 0) * 100) / 100,
          };
        })
        .filter((p) => p.paymentMethodId && p.amount > 0);
    };

    const sessions = closed
      .map((s) => {
        const tipAmount = Math.round((Number(s.tipAmount) || 0) * 100) / 100;
        let payments = parsePayments(s.payments);
        if (!payments.length && s.paymentMethodId) {
          const fromTicket = (Number(s.ticketTotal) || 0) + tipAmount;
          const fromOrders = orderSumBySession.get(s.id) || 0;
          const fallback = fromTicket > 0 ? fromTicket : fromOrders;
          if (fallback > 0) {
            payments = [
              {
                paymentMethodId: s.paymentMethodId,
                paymentMethodName: s.paymentMethodName || 'Pago',
                amount: Math.round(fallback * 100) / 100,
              },
            ];
          }
        }
        const paidSum = payments.reduce((a, p) => a + p.amount, 0);
        const fromOrders = orderSumBySession.get(s.id) || 0;
        const storedTicket = Number(s.ticketTotal) || 0;
        const fromPayments = Math.max(0, paidSum - tipAmount);
        const ticketTotal =
          Math.round(
            (storedTicket > 0 ? storedTicket : fromPayments > 0 ? fromPayments : fromOrders) *
              100,
          ) / 100;
        const hasActivity =
          ticketTotal > 0 || tipAmount > 0 || payments.length > 0 || fromOrders > 0;
        return {
          sessionId: s.id,
          tableLabel: tableLabel.get(s.salonTableId) ?? '—',
          covers: Number(s.covers) || 0,
          openedAt: s.createdAt,
          closedAt: s.closedAt,
          ticketTotal,
          tipAmount,
          tipLabel: s.tipLabel ?? null,
          payments,
          paymentLabel: payments.map((p) => p.paymentMethodName).join(' · '),
          hasActivity,
        };
      })
      .filter((s) => s.hasActivity);

    const withTip = sessions.filter((s) => s.tipAmount > 0);
    const tipTotal =
      Math.round(withTip.reduce((a, s) => a + s.tipAmount, 0) * 100) / 100;
    const ticketTotal =
      Math.round(sessions.reduce((a, s) => a + s.ticketTotal, 0) * 100) / 100;
    const coversTotal = sessions.reduce((a, s) => a + s.covers, 0);

    return {
      businessDate,
      shift: { id: shift.id, name: shift.name },
      from: ownership.from.toISOString(),
      to: ownership.to.toISOString(),
      tipTotal,
      ticketTotal,
      coversTotal,
      tippedTables: withTip.length,
      closedTables: sessions.length,
      recent: withTip.slice(0, 20).map((s) => ({
        sessionId: s.sessionId,
        tableLabel: s.tableLabel,
        tipAmount: s.tipAmount,
        tipLabel: s.tipLabel,
        closedAt: s.closedAt,
      })),
      sessions: sessions.map(({ hasActivity: _h, ...rest }) => rest),
    };
  }

  /** Imprime ticket cliente (todos los envíos) con descuento opcional, sin cerrar. */
  async printCustomerTicket(
    slug: string,
    waiter: WaiterAuthPayload,
    sessionId: string,
    opts?: { discountMode?: string | null; discountValue?: number | null },
  ) {
    assertWaiterShopSlug(waiter, slug);
    const shop = await this.requireShop(slug);
    const caps = this.caps(shop, waiter);
    this.denyUnless(caps.allowPrintCustomerTicket, 'No está permitido imprimir ticket cliente');
    const session = await this.sessions.findOne({
      where: { id: sessionId, shopId: shop.id },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status === TableSessionStatus.CLOSED) {
      throw new BadRequestException('La mesa ya está cerrada');
    }
    const orders = await this.orders.find({
      where: { shopId: shop.id, tableSessionId: session.id },
      order: { createdAt: 'ASC' },
    });
    if (!orders.length) {
      throw new BadRequestException('No hay envíos para imprimir');
    }
    const table = await this.tables.findOne({
      where: { id: session.salonTableId, shopId: shop.id },
    });
    const sessionWaiter = session.waiterEmployeeId
      ? await this.employees.findOne({
          where: { id: session.waiterEmployeeId, shopId: shop.id },
        })
      : null;
    const waiterName = sessionWaiter?.fullName?.trim() || waiter.name;
    const { promoBreakdown, sessionSubtotal: subtotal } = this.resolveSessionPromo(
      shop,
      session,
      orders,
    );
    const discountMode = caps.allowTicketDiscount ? opts?.discountMode : 'none';
    const discountValue = caps.allowTicketDiscount ? opts?.discountValue : null;
    const { discountAmount, discountLabel } = calcTicketDiscount(
      subtotal,
      discountMode,
      discountValue,
    );
    const total = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
    const items = orders.flatMap((o) =>
      (o.items ?? []).map((it) => ({
        menuItemId: it.menuItemId ?? null,
        name: it.name,
        qty: it.qty,
        unitPrice: Number(it.unitPrice) || 0,
        notes: it.notes ?? null,
        kind: it.kind || 'ITEM',
        removedIngredients: it.removedIngredients ?? [],
        attachedToMenuItemId: it.attachedToMenuItemId ?? null,
        extraId: it.extraId ?? null,
        promoId: it.promoId ?? null,
        promoBundleKey: it.promoBundleKey ?? null,
        isEntrada: !!it.isEntrada,
      })),
    );
    // Ticket de mesa: sin códigos de cada envío (AB12+CD34… queda ilegible).
    const code = '';

    try {
      await this.printAgent.enqueueTableSessionTicket(shop, {
        sessionId: session.id,
        code,
        items,
        subtotal,
        discountAmount,
        discountLabel,
        total,
        promoBreakdown,
        tableLabel: table?.label ?? null,
        waiterName,
        covers: Number(session.covers) || 2,
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        err instanceof Error ? err.message : 'No se pudo encolar el ticket',
      );
    }

    session.customerTicketPrinted = true;
    session.ticketDiscountAmount = String(discountAmount);
    session.ticketDiscountLabel = discountLabel;
    session.ticketTotal = String(total);
    await this.sessions.save(session);
    this.live.tick(shop.id, 'customer-orders');
    return this.sessionDetail(shop, session);
  }


  private resolveSessionPromo(
    shop: Shop,
    session: TableSession,
    orders: CustomerOrder[],
  ): { promoBreakdown: PromoBreakdown | null; sessionSubtotal: number } {
    const flat = orders.flatMap((o) =>
      (o.items ?? []).map((it) => ({
        menuItemId: it.menuItemId ?? null,
        name: it.name,
        qty: Number(it.qty) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        kind: it.kind || 'ITEM',
        promoId: it.promoId ?? null,
        notes: it.notes ?? null,
        extraId: it.extraId ?? null,
        attachedToMenuItemId: it.attachedToMenuItemId ?? null,
      })),
    );
    const assigned = this.readSessionPromos(session);
    const byId = new Map(normalizeShopPromos(shop.promos).map((p) => [p.id, p] as const));
    const assignments: Array<{ promo: NonNullable<ReturnType<typeof byId.get>>; maxCount: number | null }> =
      [];
    for (const a of assigned) {
      const promo = byId.get(a.promoId);
      if (promo) assignments.push({ promo, maxCount: a.maxCount });
    }

    const promoBreakdown = computeMultiPromoBreakdown(flat, assignments, {
      timezone: shop.timezone,
    });
    const raw = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const sessionSubtotal = promoBreakdown
      ? promoBreakdown.baseTotal
      : Math.max(0, Math.round(raw * 100) / 100);
    return { promoBreakdown, sessionSubtotal };
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
    const audits = await this.lineAudits.find({
      where: { shopId: shop.id, tableSessionId: session.id },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const { promoBreakdown, sessionSubtotal: subtotal } = this.resolveSessionPromo(
      shop,
      session,
      orders,
    );
    const catalog = normalizeShopPromos(shop.promos);
    const byId = new Map(catalog.map((p) => [p.id, p] as const));
    const sessionPromos = this.readSessionPromos(session).map((a) => ({
      promoId: a.promoId,
      maxCount: a.maxCount,
      name: byId.get(a.promoId)?.name ?? a.promoId,
    }));
    return {
      id: session.id,
      status: session.status,
      covers: Number(session.covers) || 2,
      promoId: sessionPromos[0]?.promoId ?? null,
      promoMaxCount: sessionPromos[0]?.maxCount ?? null,
      promoName: sessionPromos[0]?.name ?? null,
      sessionPromos,
      promoBreakdown,
      customerTicketPrinted: !!session.customerTicketPrinted,
      ticketDiscountAmount: Number(session.ticketDiscountAmount ?? 0) || 0,
      ticketDiscountLabel: session.ticketDiscountLabel ?? null,
      ticketTotal:
        session.ticketTotal == null ? null : Number(session.ticketTotal) || 0,
      paymentMethodId: session.paymentMethodId ?? null,
      paymentMethodName: session.paymentMethodName ?? null,
      payments: Array.isArray(session.payments)
        ? session.payments.map((p) => ({
            paymentMethodId: p.paymentMethodId,
            paymentMethodName: p.paymentMethodName,
            paymentAccountId: p.paymentAccountId ?? null,
            amount: Number(p.amount) || 0,
          }))
        : session.paymentMethodId
          ? [
              {
                paymentMethodId: session.paymentMethodId,
                paymentMethodName: session.paymentMethodName ?? '',
                paymentAccountId: session.paymentAccountId ?? null,
                amount:
                  session.ticketTotal == null
                    ? subtotal
                    : Number(session.ticketTotal) || 0,
              },
            ]
          : [],
      tipAmount: Number(session.tipAmount ?? 0) || 0,
      tipLabel: session.tipLabel ?? null,
      paymentMethods: normalizeTablePaymentMethods(shop.tablePaymentMethods).filter(
        (m) => m.active !== false,
      ),
      sessionSubtotal: subtotal,
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
      lineAudits: audits.map((a) => ({
        id: a.id,
        action: a.action,
        orderCode: a.orderCode,
        itemName: a.itemName,
        lineKind: a.lineKind,
        qtyBefore: a.qtyBefore,
        qtyAfter: a.qtyAfter,
        unitPriceBefore:
          a.unitPriceBefore == null ? null : Number(a.unitPriceBefore) || 0,
        unitPriceAfter:
          a.unitPriceAfter == null ? null : Number(a.unitPriceAfter) || 0,
        relatedLines: a.relatedLines ?? [],
        actorName: a.actorName,
        actorTyp: a.actorTyp,
        orderRemoved: !!a.orderRemoved,
        createdAt: a.createdAt,
      })),
    };
  }
}
