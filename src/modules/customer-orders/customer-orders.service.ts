import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, In, Not, MoreThanOrEqual, LessThan, Repository } from 'typeorm';
import {
  CustomerOrder,
  CustomerOrderFulfillment,
  CustomerOrderLine,
  CustomerOrderPaymentMethod,
  CustomerOrderStatus,
} from '../../entities/customer-order.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole, NotificationType } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { isGlobalAdmin } from '../../common/guards';
import {
  nextCalendarDate,
  normalizeOpeningTime,
  resolveShopBusinessDate,
  shopBusinessDayRangeUtc,
} from '../../common/business-date';
import {
  normalizeShopShifts,
  previousShiftBusinessDate,
  previousShiftOf,
  resolveCurrentShift,
  shopShiftOwnershipRangeUtc,
  weekdayFromIsoDate,
  type ShopShift,
} from '../../common/shop-shifts';
import {
  formatOrderingHoursSummary,
  isOrderingChannelOpenNow,
  normalizeDeliveryZones,
  normalizeOrderingEta,
  normalizeOrderingExtras,
  normalizeOrderingPayments,
  normalizeShopMode,
  normalizeShopOrderingHours,
} from '../../common/shop-ordering';
import { normalizeRemovableIngredients, normalizeShopMenus, ShopMenuItem } from '../menu/menu-parse.util';
import { NotificationsService } from '../notifications/notifications.service';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { userShopCanReceiveCustomerOrders } from '../profile/notification-eligibility';
import {
  CreateCustomerOrderDto,
  UpdateCustomerOrderStatusDto,
} from './dto/customer-order.dto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class CustomerOrdersService implements OnModuleInit {
  constructor(
    @InjectRepository(CustomerOrder)
    private readonly orders: Repository<CustomerOrder>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(UserShop)
    private readonly userShops: Repository<UserShop>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly live: ShopLiveService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    try {
      await this.orders.query(`
        CREATE TABLE IF NOT EXISTS customer_orders (
          id CHAR(36) NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          shopId CHAR(36) NOT NULL,
          code VARCHAR(12) NOT NULL,
          status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
          fulfillment VARCHAR(16) NOT NULL,
          items JSON NOT NULL,
          subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
          deliveryFee DECIMAL(12,2) NOT NULL DEFAULT 0,
          discountAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
          discountLabel VARCHAR(40) NULL,
          total DECIMAL(12,2) NOT NULL DEFAULT 0,
          firstName VARCHAR(80) NOT NULL,
          lastName VARCHAR(80) NOT NULL,
          phone VARCHAR(40) NOT NULL,
          address VARCHAR(300) NULL,
          deliveryZoneId VARCHAR(40) NULL,
          deliveryZoneName VARCHAR(80) NULL,
          paymentMethod VARCHAR(16) NOT NULL,
          cashAmount DECIMAL(12,2) NULL,
          customerNotes VARCHAR(500) NULL,
          acceptedAt DATETIME(6) NULL,
          preparingAt DATETIME(6) NULL,
          readyAt DATETIME(6) NULL,
          outForDeliveryAt DATETIME(6) NULL,
          completedAt DATETIME(6) NULL,
          cancelledAt DATETIME(6) NULL,
          PRIMARY KEY (id),
          UNIQUE KEY idx_customer_orders_shop_code (shopId, code),
          KEY idx_customer_orders_shop_created (shopId, createdAt),
          KEY idx_customer_orders_shop_status (shopId, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch {
      // tabla ya existe / dialecto distinto
    }
    try {
      await this.orders.query(
        `ALTER TABLE customer_orders ADD COLUMN discountAmount DECIMAL(12,2) NOT NULL DEFAULT 0`,
      );
    } catch {
      /* already exists */
    }
    try {
      await this.orders.query(
        `ALTER TABLE customer_orders ADD COLUMN discountLabel VARCHAR(40) NULL`,
      );
    } catch {
      /* already exists */
    }
  }

  private assertShopAccess(user: AuthUser, shopId: string) {
    if (isGlobalAdmin(user.globalRole as any)) return;
    const ok = (user.shopIds ?? []).includes(shopId);
    if (!ok) throw new NotFoundException('Local no encontrado');
  }

  private normalizePhone(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '').slice(0, 40);
  }

  private async genCode(shopId: string): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      const exists = await this.orders.exists({ where: { shopId, code } });
      if (!exists) return code;
    }
    return `X${Date.now().toString(36).slice(-5).toUpperCase()}`;
  }

  private menuItemIndex(shop: Shop): Map<string, ShopMenuItem & { unitPrice: number }> {
    const map = new Map<string, ShopMenuItem & { unitPrice: number }>();
    for (const menu of normalizeShopMenus(shop.menu)) {
      for (const sec of menu.sections ?? []) {
        for (const it of sec.items ?? []) {
          const id = String(it.id ?? '').trim();
          if (!id) continue;
          const price = it.price == null ? null : Number(it.price);
          if (price == null || !Number.isFinite(price) || price < 0) continue;
          if (it.available === false) continue;
          map.set(id, { ...it, unitPrice: price });
        }
      }
    }
    return map;
  }

  private toDto(o: CustomerOrder) {
    return {
      id: o.id,
      shopId: o.shopId,
      code: o.code,
      status: o.status,
      fulfillment: o.fulfillment,
      items: o.items ?? [],
      subtotal: Number(o.subtotal),
      deliveryFee: Number(o.deliveryFee),
      discountAmount: Number(o.discountAmount ?? 0),
      discountLabel: o.discountLabel ?? null,
      total: Number(o.total),
      firstName: o.firstName,
      lastName: o.lastName,
      phone: o.phone,
      address: o.address ?? null,
      deliveryZoneId: o.deliveryZoneId ?? null,
      deliveryZoneName: o.deliveryZoneName ?? null,
      paymentMethod: o.paymentMethod,
      cashAmount: o.cashAmount == null ? null : Number(o.cashAmount),
      customerNotes: o.customerNotes ?? null,
      acceptedAt: o.acceptedAt ?? null,
      preparingAt: o.preparingAt ?? null,
      readyAt: o.readyAt ?? null,
      outForDeliveryAt: o.outForDeliveryAt ?? null,
      completedAt: o.completedAt ?? null,
      cancelledAt: o.cancelledAt ?? null,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt ?? null,
    };
  }

  private resolveReceiptWhatsapp(shop: Shop): string | null {
    const payments = normalizeOrderingPayments(shop.orderingPayments);
    for (const raw of [payments?.whatsapp, shop.phone]) {
      const digits = String(raw ?? '').replace(/\D/g, '');
      if (digits.length >= 8) return digits;
    }
    return null;
  }

  private publicDto(o: CustomerOrder, shop?: Shop | null) {
    const full = this.toDto(o);
    const isTransfer = full.paymentMethod === CustomerOrderPaymentMethod.TRANSFER;
    const payments = shop ? normalizeOrderingPayments(shop.orderingPayments) : null;
    const receiptWhatsapp = isTransfer && shop ? this.resolveReceiptWhatsapp(shop) : null;
    const transferInstructions =
      isTransfer ? payments?.transferInstructions ?? null : null;
    return {
      code: full.code,
      status: full.status,
      fulfillment: full.fulfillment,
      items: full.items,
      subtotal: full.subtotal,
      deliveryFee: full.deliveryFee,
      discountAmount: full.discountAmount,
      discountLabel: full.discountLabel,
      total: full.total,
      firstName: full.firstName,
      lastName: full.lastName,
      paymentMethod: full.paymentMethod,
      deliveryZoneName: full.deliveryZoneName,
      address: full.address,
      createdAt: full.createdAt,
      acceptedAt: full.acceptedAt,
      preparingAt: full.preparingAt,
      readyAt: full.readyAt,
      outForDeliveryAt: full.outForDeliveryAt,
      completedAt: full.completedAt,
      cancelledAt: full.cancelledAt,
      receiptWhatsapp,
      transferInstructions,
    };
  }

  async getPublicOrderingConfig(slug: string) {
    const shop = await this.shops.findOne({ where: { slug, active: true as any } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.onlineOrderingEnabled) {
      throw new NotFoundException('Pedidos online no disponibles');
    }

    const hours = normalizeShopOrderingHours(shop.orderingHours);
    const takeawayHours = hours?.takeaway ?? null;
    const deliveryHours = hours?.delivery ?? null;
    const now = new Date();
    const forceClosed = !!shop.orderingForceClosed;
    const takeawayEnabled = shop.takeawayEnabled !== false;
    const deliveryEnabled = !!shop.deliveryEnabled;
    const takeawayOpen =
      !forceClosed &&
      takeawayEnabled &&
      isOrderingChannelOpenNow(takeawayHours, now, shop.timezone);
    const deliveryOpen =
      !forceClosed &&
      deliveryEnabled &&
      isOrderingChannelOpenNow(deliveryHours, now, shop.timezone);
    const payments = normalizeOrderingPayments(shop.orderingPayments) ?? {
      methods: ['CASH', 'TRANSFER'] as CustomerOrderPaymentMethod[],
      transferInstructions: null,
      whatsapp: null,
    };
    const zones = normalizeDeliveryZones(shop.deliveryZones);
    const eta = normalizeOrderingEta(shop.orderingEta);
    const menus = normalizeShopMenus(shop.menu);

    return {
      enabled: true,
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
        accentSecondary: shop.accentSecondary ?? null,
        phone: shop.phone ?? null,
        instagramHandle: shop.instagramHandle ?? null,
        currency: shop.currency || 'ARS',
        shopMode: normalizeShopMode(shop.shopMode),
      },
      takeawayEnabled,
      deliveryEnabled,
      orderingForceClosed: forceClosed,
      takeawayOpen,
      deliveryOpen,
      anyChannelOpen: takeawayOpen || deliveryOpen,
      takeawayHoursSummary: formatOrderingHoursSummary(takeawayHours),
      deliveryHoursSummary: formatOrderingHoursSummary(deliveryHours),
      orderingHours: hours,
      payments,
      deliveryZones: zones,
      eta,
      extras: normalizeOrderingExtras(shop.orderingExtras)
        .filter((e) => e.available !== false)
        .map((e) => ({
          id: e.id,
          name: e.name,
          price: e.price,
          menuItemIds: e.menuItemIds ?? [],
        })),
      menus: menus.map((m) => ({
        id: m.id,
        slug: m.slug,
        title: m.title,
        note: m.note,
        sections: (m.sections ?? []).map((sec) => ({
          name: sec.name,
          items: (sec.items ?? [])
            .filter((it) => it.available !== false && it.price != null)
            .map((it) => ({
              id: it.id,
              name: it.name,
              description: it.description ?? null,
              price: it.price,
              priceLabel: it.priceLabel ?? null,
              removableIngredients: it.removableIngredients ?? [],
              imageUrl: it.imageUrl
                ? `/public/shops/${shop.slug}/menu-items/${encodeURIComponent(String(it.id))}/image`
                : null,
            })),
        })),
      })),
    };
  }

  async createPublic(slug: string, dto: CreateCustomerOrderDto) {
    const shop = await this.shops.findOne({ where: { slug, active: true as any } });
    if (!shop || !shop.onlineOrderingEnabled) {
      throw new NotFoundException('Pedidos online no disponibles');
    }
    if (shop.orderingForceClosed) {
      throw new BadRequestException('El local está cerrado para pedidos online');
    }
    return this.createOrderForShop(shop, dto, {
      bypassHours: false,
      response: 'public',
      allowDiscount: false,
    });
  }

  async createStaff(user: AuthUser, shopId: string, dto: CreateCustomerOrderDto) {
    this.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId, active: true as any } });
    if (!shop || !shop.onlineOrderingEnabled) {
      throw new NotFoundException('Pedidos online no disponibles');
    }
    return this.createOrderForShop(
      shop,
      { ...dto, fulfillment: CustomerOrderFulfillment.COUNTER },
      {
        bypassHours: true,
        response: 'staff',
        allowDiscount: true,
      },
    );
  }

  private async createOrderForShop(
    shop: Shop,
    dto: CreateCustomerOrderDto,
    opts: { bypassHours: boolean; response: 'public' | 'staff'; allowDiscount: boolean },
  ) {
    const takeawayEnabled = shop.takeawayEnabled !== false;
    const deliveryEnabled = !!shop.deliveryEnabled;
    const hours = normalizeShopOrderingHours(shop.orderingHours);
    const now = new Date();

    if (dto.fulfillment === CustomerOrderFulfillment.COUNTER) {
      if (opts.response !== 'staff') {
        throw new BadRequestException('Tipo de entrega inválido');
      }
    } else if (dto.fulfillment === CustomerOrderFulfillment.TAKEAWAY) {
      if (!takeawayEnabled) throw new BadRequestException('Take away no disponible');
      if (
        !opts.bypassHours &&
        !isOrderingChannelOpenNow(hours?.takeaway, now, shop.timezone)
      ) {
        throw new BadRequestException('Take away cerrado en este momento');
      }
    } else if (dto.fulfillment === CustomerOrderFulfillment.DELIVERY) {
      if (!deliveryEnabled) throw new BadRequestException('Delivery no disponible');
      if (
        !opts.bypassHours &&
        !isOrderingChannelOpenNow(hours?.delivery, now, shop.timezone)
      ) {
        throw new BadRequestException('Delivery cerrado en este momento');
      }
    } else {
      throw new BadRequestException('Tipo de entrega inválido');
    }

    const payments = normalizeOrderingPayments(shop.orderingPayments) ?? {
      methods: ['CASH', 'TRANSFER'] as CustomerOrderPaymentMethod[],
      transferInstructions: null,
      whatsapp: null,
    };
    if (!payments.methods?.includes(dto.paymentMethod)) {
      throw new BadRequestException('Medio de pago no disponible');
    }

    const catalog = this.menuItemIndex(shop);
    const lines: CustomerOrderLine[] = [];
    let subtotal = 0;
    for (const row of dto.items) {
      const found = catalog.get(String(row.menuItemId).trim());
      if (!found) {
        throw new BadRequestException(`Ítem no disponible: ${row.menuItemId}`);
      }
      const qty = Math.max(1, Math.min(99, Number(row.qty) || 1));
      const unitPrice = found.unitPrice;
      subtotal += unitPrice * qty;
      const allowedRemoved = new Set(
        (found.removableIngredients ?? []).map((x) => x.toLowerCase()),
      );
      const removedIngredients = normalizeRemovableIngredients(row.removedIngredients).filter(
        (name) => allowedRemoved.has(name.toLowerCase()),
      );
      lines.push({
        menuItemId: String(found.id),
        name: found.name,
        unitPrice,
        qty,
        notes: String(row.notes ?? '').trim().slice(0, 300) || null,
        kind: 'ITEM',
        removedIngredients: removedIngredients.length ? removedIngredients : undefined,
      });
    }

    const extrasCatalog = new Map(
      normalizeOrderingExtras(shop.orderingExtras)
        .filter((e) => e.available !== false)
        .map((e) => [e.id, e]),
    );
    const orderedItemIds = new Set(lines.map((l) => l.menuItemId));
    for (const row of dto.extras ?? []) {
      const extra = extrasCatalog.get(String(row.extraId ?? '').trim());
      if (!extra) throw new BadRequestException(`Extra no disponible: ${row.extraId}`);
      const attached = String(row.attachedToMenuItemId ?? '').trim() || null;
      const allowed = extra.menuItemIds ?? [];
      if (allowed.length) {
        if (!attached || !allowed.includes(attached)) {
          throw new BadRequestException(`Extra "${extra.name}" no aplica a ese ítem`);
        }
        if (!orderedItemIds.has(attached)) {
          throw new BadRequestException(`Extra "${extra.name}" requiere el ítem en el pedido`);
        }
      }
      const qty = Math.max(1, Math.min(99, Number(row.qty) || 1));
      subtotal += extra.price * qty;
      lines.push({
        menuItemId: attached || extra.id,
        name: extra.name,
        unitPrice: extra.price,
        qty,
        notes: null,
        kind: 'EXTRA',
        extraId: extra.id,
        attachedToMenuItemId: attached,
      });
    }

    if (!lines.length) throw new BadRequestException('El pedido no tiene ítems');

    let deliveryFee = 0;
    let deliveryZoneId: string | null = null;
    let deliveryZoneName: string | null = null;
    let address: string | null = null;

    if (dto.fulfillment === CustomerOrderFulfillment.DELIVERY) {
      const zones = normalizeDeliveryZones(shop.deliveryZones);
      if (!zones.length) {
        throw new BadRequestException('No hay zonas de delivery configuradas');
      }
      const zone = zones.find((z) => z.id === String(dto.deliveryZoneId ?? '').trim());
      if (!zone) throw new BadRequestException('Seleccioná una zona de entrega');
      const addr = String(dto.address ?? '').trim();
      if (addr.length < 5) throw new BadRequestException('Ingresá la dirección de entrega');
      deliveryFee = zone.fee;
      deliveryZoneId = zone.id;
      deliveryZoneName = zone.name;
      address = addr.slice(0, 300);
    }

    let discountAmount = 0;
    let discountLabel: string | null = null;
    if (opts.allowDiscount) {
      const pct = Number(dto.discountPercent);
      const fixed = Number(dto.discountFixed);
      const hasPct = Number.isFinite(pct) && pct > 0;
      const hasFixed = Number.isFinite(fixed) && fixed > 0;
      if (hasPct && hasFixed) {
        throw new BadRequestException('Usá descuento en % o en monto, no ambos');
      }
      if (hasPct) {
        const p = Math.min(100, pct);
        discountAmount = Math.round(subtotal * (p / 100) * 100) / 100;
        discountLabel = `${p % 1 === 0 ? String(p) : p.toFixed(1)}%`;
      } else if (hasFixed) {
        discountAmount = Math.min(subtotal, Math.round(fixed * 100) / 100);
        discountLabel = 'Monto';
      }
      if (discountAmount > subtotal) discountAmount = subtotal;
    }

    const total = Math.max(0, Math.round((subtotal - discountAmount + deliveryFee) * 100) / 100);

    if (dto.paymentMethod === CustomerOrderPaymentMethod.CASH) {
      const cash = Number(dto.cashAmount);
      if (!Number.isFinite(cash) || cash < total) {
        throw new BadRequestException('Indicá con cuánto abonás (debe cubrir el total)');
      }
    }

    const phone = this.normalizePhone(dto.phone);
    if (phone.length < 6) throw new BadRequestException('Celular inválido');

    const code = await this.genCode(shop.id);
    const isCounter = dto.fulfillment === CustomerOrderFulfillment.COUNTER;
    const initialStatus = isCounter
      ? CustomerOrderStatus.PREPARING
      : CustomerOrderStatus.PENDING;
    const order = await this.orders.save(
      this.orders.create({
        shopId: shop.id,
        code,
        status: initialStatus,
        fulfillment: dto.fulfillment,
        items: lines,
        subtotal: subtotal.toFixed(2),
        deliveryFee: deliveryFee.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        discountLabel,
        total: total.toFixed(2),
        firstName: String(dto.firstName).trim().slice(0, 80),
        lastName: String(dto.lastName).trim().slice(0, 80),
        phone,
        address,
        deliveryZoneId,
        deliveryZoneName,
        paymentMethod: dto.paymentMethod,
        cashAmount:
          dto.paymentMethod === CustomerOrderPaymentMethod.CASH
            ? Number(dto.cashAmount).toFixed(2)
            : null,
        customerNotes: String(dto.customerNotes ?? '').trim().slice(0, 500) || null,
        acceptedAt: isCounter ? now : null,
        preparingAt: isCounter ? now : null,
      }),
    );

    this.live.tick(shop.id, 'customer-orders');
    void this.notifyStaffNewOrder(shop, order);
    return opts.response === 'staff' ? this.toDto(order) : this.publicDto(order, shop);
  }

  async pendingCount(user: AuthUser, shopId: string) {
    this.assertShopAccess(user, shopId);
    const count = await this.orders.count({
      where: { shopId, status: CustomerOrderStatus.PENDING },
    });
    return { count };
  }

  async lookupPublic(slug: string, phone: string, code: string) {
    const shop = await this.shops.findOne({ where: { slug, active: true as any } });
    if (!shop || !shop.onlineOrderingEnabled) {
      throw new NotFoundException('Pedidos online no disponibles');
    }
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedCode = String(code ?? '').trim().toUpperCase();
    if (!normalizedPhone || !normalizedCode) {
      throw new BadRequestException('Ingresá celular y código de pedido');
    }
    const order = await this.orders.findOne({
      where: { shopId: shop.id, code: normalizedCode, phone: normalizedPhone },
      order: { createdAt: 'DESC' },
    });
    if (!order) throw new NotFoundException('No encontramos ese pedido');
    return this.publicDto(order, shop);
  }

  async listStaff(
    user: AuthUser,
    shopId: string,
    opts?: { status?: CustomerOrderStatus | CustomerOrderStatus[] },
  ) {
    this.assertShopAccess(user, shopId);
    const where: any = { shopId };
    if (opts?.status) {
      where.status = Array.isArray(opts.status) ? In(opts.status) : opts.status;
    }
    const rows = await this.orders.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Totales de pedidos del turno para precargar un cierre de caja.
   * Usa la ventana de propiedad (abre → abre el siguiente). Si el turno vigente
   * no tiene pedidos (p.ej. recién empezó), cae al turno anterior.
   */
  async closingSummary(
    user: AuthUser,
    shopId: string,
    opts?: { businessDate?: string; shiftId?: string },
  ) {
    this.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');

    const shifts = normalizeShopShifts(shop.shifts as ShopShift[] | null, shop.openingTime);
    const pinnedShiftId = String(opts?.shiftId ?? '').trim();
    let date =
      opts?.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.businessDate)
        ? opts.businessDate
        : resolveShopBusinessDate(new Date(), {
            timezone: shop.timezone,
            openingTime: shop.openingTime,
          });

    let shift =
      (pinnedShiftId ? shifts.find((s) => s.id === pinnedShiftId) : null) ??
      resolveCurrentShift(shifts, new Date(), shop.timezone);

    const loadRows = async (businessDate: string, s: ShopShift) => {
      const ownership = shopShiftOwnershipRangeUtc(businessDate, s, shifts, {
        timezone: shop.timezone,
      });
      const found = await this.orders.find({
        where: {
          shopId,
          status: Not(CustomerOrderStatus.CANCELLED),
          createdAt: And(MoreThanOrEqual(ownership.from), LessThan(ownership.to)),
        },
        order: { createdAt: 'ASC' },
        take: 2000,
      });
      return { rows: found, range: ownership };
    };

    let { rows, range } = await loadRows(date, shift);

    // Si el turno pedido/vigente no tiene ventas, probar el anterior aunque viniera shiftId
    // (al generar cierre suele ser el caso: Mañana recién abrió y las ventas son de la mañana).
    if (!rows.length) {
      const weekday = weekdayFromIsoDate(date) ?? 1;
      const prev = previousShiftOf(shift, shifts, weekday);
      const prevDate = previousShiftBusinessDate(date, shift, prev, shifts);
      const prevLoad = await loadRows(prevDate, prev);
      if (prevLoad.rows.length) {
        rows = prevLoad.rows;
        range = prevLoad.range;
        shift = prev;
        date = prevDate;
      } else {
        // Día laboral completo actual, luego el anterior.
        const day = shopBusinessDayRangeUtc(date, {
          timezone: shop.timezone,
          openingTime: shop.openingTime,
        });
        const dayRows = await this.orders.find({
          where: {
            shopId,
            status: Not(CustomerOrderStatus.CANCELLED),
            createdAt: And(MoreThanOrEqual(day.from), LessThan(day.to)),
          },
          order: { createdAt: 'ASC' },
          take: 2000,
        });
        if (dayRows.length) {
          rows = dayRows;
          range = {
            from: day.from,
            to: day.to,
            untilOpensAt: normalizeOpeningTime(shop.openingTime),
            untilDate: nextCalendarDate(date),
          };
        } else {
          const prevDayDate = previousShiftBusinessDate(date, shift, prev, shifts);
          const prevDay = shopBusinessDayRangeUtc(prevDayDate, {
            timezone: shop.timezone,
            openingTime: shop.openingTime,
          });
          const prevDayRows = await this.orders.find({
            where: {
              shopId,
              status: Not(CustomerOrderStatus.CANCELLED),
              createdAt: And(MoreThanOrEqual(prevDay.from), LessThan(prevDay.to)),
            },
            order: { createdAt: 'ASC' },
            take: 2000,
          });
          if (prevDayRows.length) {
            rows = prevDayRows;
            range = {
              from: prevDay.from,
              to: prevDay.to,
              untilOpensAt: normalizeOpeningTime(shop.openingTime),
              untilDate: nextCalendarDate(prevDayDate),
            };
            date = prevDayDate;
          }
        }
      }
    }

    type Bucket = {
      cashTotal: number;
      transferTotal: number;
      orderCount: number;
      unitsSold: number;
    };
    const emptyBucket = (): Bucket => ({
      cashTotal: 0,
      transferTotal: 0,
      orderCount: 0,
      unitsSold: 0,
    });
    const byFulfillment: Record<string, Bucket> = {
      TAKEAWAY: emptyBucket(),
      DELIVERY: emptyBucket(),
      COUNTER: emptyBucket(),
    };

    let cashTotal = 0;
    let transferTotal = 0;
    let unitsSold = 0;
    let openCount = 0;
    const orderIds: string[] = [];

    const round2 = (n: number) => Math.round(n * 100) / 100;

    for (const row of rows) {
      orderIds.push(row.id);
      const total = Number(row.total) || 0;
      const fulfillment = String(row.fulfillment || 'TAKEAWAY');
      const bucket = byFulfillment[fulfillment] ?? byFulfillment.TAKEAWAY;
      bucket.orderCount += 1;
      if (row.paymentMethod === CustomerOrderPaymentMethod.TRANSFER) {
        transferTotal += total;
        bucket.transferTotal += total;
      } else {
        cashTotal += total;
        bucket.cashTotal += total;
      }
      for (const line of row.items ?? []) {
        const qty = Math.max(0, Number(line.qty) || 0);
        unitsSold += qty;
        bucket.unitsSold += qty;
      }
      if (row.status !== CustomerOrderStatus.COMPLETED) openCount += 1;
    }

    const mapBucket = (b: Bucket) => ({
      cashTotal: round2(b.cashTotal),
      transferTotal: round2(b.transferTotal),
      total: round2(b.cashTotal + b.transferTotal),
      orderCount: b.orderCount,
      unitsSold: b.unitsSold,
    });

    return {
      businessDate: date,
      shiftId: shift.id,
      shiftName: shift.name,
      opensAt: shift.opensAt,
      closesAt: shift.closesAt,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      orderCount: rows.length,
      openCount,
      completedCount: rows.length - openCount,
      cashTotal: round2(cashTotal),
      transferTotal: round2(transferTotal),
      total: round2(cashTotal + transferTotal),
      unitsSold,
      byFulfillment: {
        TAKEAWAY: mapBucket(byFulfillment.TAKEAWAY),
        DELIVERY: mapBucket(byFulfillment.DELIVERY),
        COUNTER: mapBucket(byFulfillment.COUNTER),
      },
      orderIds,
      orderingForceClosed: !!shop.orderingForceClosed,
      defaultChangeAmount: Number(shop.defaultChangeAmount) || 0,
    };
  }

  async getStaff(user: AuthUser, shopId: string, id: string) {
    this.assertShopAccess(user, shopId);
    const order = await this.orders.findOne({ where: { id, shopId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return this.toDto(order);
  }

  async updateStatus(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: UpdateCustomerOrderStatusDto,
  ) {
    this.assertShopAccess(user, shopId);
    const order = await this.orders.findOne({ where: { id, shopId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const next = dto.status;
    const prev = order.status;
    if (prev === CustomerOrderStatus.CANCELLED || prev === CustomerOrderStatus.COMPLETED) {
      throw new BadRequestException('El pedido ya está cerrado');
    }
    if (next === prev) return this.toDto(order);

    const now = new Date();
    order.status = next;
    if (next === CustomerOrderStatus.ACCEPTED) order.acceptedAt = now;
    if (next === CustomerOrderStatus.PREPARING) order.preparingAt = now;
    if (next === CustomerOrderStatus.READY) order.readyAt = now;
    if (next === CustomerOrderStatus.OUT_FOR_DELIVERY) order.outForDeliveryAt = now;
    if (next === CustomerOrderStatus.COMPLETED) order.completedAt = now;
    if (next === CustomerOrderStatus.CANCELLED) order.cancelledAt = now;

    await this.orders.save(order);
    this.live.tick(shopId, 'customer-orders');
    return this.toDto(order);
  }

  private async notifyStaffNewOrder(shop: Shop, order: CustomerOrder) {
    try {
      const links = await this.userShops.find({ where: { shopId: shop.id } });
      const userIds = [...new Set(links.map((l) => l.userId))];
      const users = userIds.length
        ? await this.users.find({
            where: { id: In(userIds) },
            select: ['id', 'active', 'globalRole'],
          })
        : [];
      const userById = new Map(users.map((u) => [u.id, u]));
      const recipientIds = new Set<string>();
      for (const link of links) {
        const u = userById.get(link.userId);
        if (!u || !isEntityActive(u.active)) continue;
        if (userShopCanReceiveCustomerOrders(link, u.globalRole as GlobalRole)) {
          recipientIds.add(u.id);
        }
      }
      const globalOwners = await this.users.find({
        where: { globalRole: GlobalRole.OWNER },
        select: ['id', 'active'],
      });
      for (const u of globalOwners) {
        if (isEntityActive(u.active)) recipientIds.add(u.id);
      }
      if (!recipientIds.size) return;

      const channel =
        order.fulfillment === CustomerOrderFulfillment.DELIVERY
          ? 'Delivery'
          : order.fulfillment === CustomerOrderFulfillment.COUNTER
            ? 'Mostrador'
            : 'Take away';
      const guest = `${order.firstName} ${order.lastName}`.trim();
      const total = Number(order.total).toLocaleString('es-AR', {
        style: 'currency',
        currency: shop.currency || 'ARS',
        maximumFractionDigits: 0,
      });
      const shopName = shop.name?.trim() || 'Local';
      await this.notifications.createMany(
        [...recipientIds].map((userId) => ({
          userId,
          shopId: shop.id,
          type: NotificationType.CUSTOMER_ORDER_CREATED,
          title: `Pedido ${order.code}`,
          body: `${shopName}: ${channel} · ${guest} · ${total}`,
          targetId: order.id,
        })),
      );
    } catch {
      // no bloquear el pedido público si falla el aviso
    }
  }
}
