import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
  formatOrderingHoursSummary,
  isOrderingChannelOpenNow,
  normalizeDeliveryZones,
  normalizeOrderingEta,
  normalizeOrderingExtras,
  normalizeOrderingPayments,
  normalizeShopMode,
  normalizeShopOrderingHours,
} from '../../common/shop-ordering';
import { normalizeShopMenus, ShopMenuItem } from '../menu/menu-parse.util';
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
    const takeawayEnabled = shop.takeawayEnabled !== false;
    const deliveryEnabled = !!shop.deliveryEnabled;
    const takeawayOpen =
      takeawayEnabled && isOrderingChannelOpenNow(takeawayHours, now, shop.timezone);
    const deliveryOpen =
      deliveryEnabled && isOrderingChannelOpenNow(deliveryHours, now, shop.timezone);
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

    const takeawayEnabled = shop.takeawayEnabled !== false;
    const deliveryEnabled = !!shop.deliveryEnabled;
    const hours = normalizeShopOrderingHours(shop.orderingHours);
    const now = new Date();

    if (dto.fulfillment === CustomerOrderFulfillment.TAKEAWAY) {
      if (!takeawayEnabled) throw new BadRequestException('Take away no disponible');
      if (!isOrderingChannelOpenNow(hours?.takeaway, now, shop.timezone)) {
        throw new BadRequestException('Take away cerrado en este momento');
      }
    } else if (dto.fulfillment === CustomerOrderFulfillment.DELIVERY) {
      if (!deliveryEnabled) throw new BadRequestException('Delivery no disponible');
      if (!isOrderingChannelOpenNow(hours?.delivery, now, shop.timezone)) {
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
      lines.push({
        menuItemId: String(found.id),
        name: found.name,
        unitPrice,
        qty,
        notes: String(row.notes ?? '').trim().slice(0, 300) || null,
        kind: 'ITEM',
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

    if (dto.paymentMethod === CustomerOrderPaymentMethod.CASH) {
      const cash = Number(dto.cashAmount);
      if (!Number.isFinite(cash) || cash < subtotal + deliveryFee) {
        throw new BadRequestException('Indicá con cuánto abonás (debe cubrir el total)');
      }
    }

    const phone = this.normalizePhone(dto.phone);
    if (phone.length < 6) throw new BadRequestException('Celular inválido');

    const code = await this.genCode(shop.id);
    const total = subtotal + deliveryFee;
    const order = await this.orders.save(
      this.orders.create({
        shopId: shop.id,
        code,
        status: CustomerOrderStatus.PENDING,
        fulfillment: dto.fulfillment,
        items: lines,
        subtotal: subtotal.toFixed(2),
        deliveryFee: deliveryFee.toFixed(2),
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
      }),
    );

    this.live.tick(shop.id, 'customer-orders');
    void this.notifyStaffNewOrder(shop, order);
    return this.publicDto(order, shop);
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
        order.fulfillment === CustomerOrderFulfillment.DELIVERY ? 'Delivery' : 'Take away';
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
