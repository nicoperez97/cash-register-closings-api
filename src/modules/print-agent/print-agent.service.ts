import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import {
  CustomerOrder,
  CustomerOrderFulfillment,
  CustomerOrderPaymentMethod,
} from '../../entities/customer-order.entity';
import { PrintJob, PrintJobKind, PrintJobStatus } from '../../entities/print-job.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { ShopsService } from '../shops/shops.service';
import { normalizeShopMenus } from '../menu/menu-parse.util';
import { normalizeOrderingExtras } from '../../common/shop-ordering';

type AgentShop = Pick<Shop, 'id' | 'name' | 'slug' | 'timezone' | 'printAgentTokenHash'>;

@Injectable()
export class PrintAgentService implements OnModuleInit {
  constructor(
    @InjectRepository(PrintJob) private readonly jobs: Repository<PrintJob>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    private readonly shopsSvc: ShopsService,
    private readonly live: ShopLiveService,
  ) {}

  async onModuleInit() {
    try {
      await this.jobs.query(`
        CREATE TABLE IF NOT EXISTS print_jobs (
          id CHAR(36) NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          shopId CHAR(36) NOT NULL,
          kind VARCHAR(24) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
          sourceId VARCHAR(80) NULL,
          copies INT NOT NULL DEFAULT 1,
          payload JSON NOT NULL,
          error VARCHAR(500) NULL,
          printedAt DATETIME(6) NULL,
          PRIMARY KEY (id),
          UNIQUE KEY idx_print_jobs_shop_source (shopId, sourceId),
          KEY idx_print_jobs_shop_status (shopId, status, createdAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch {
      /* already exists / dialect */
    }
    for (const sql of [
      `ALTER TABLE shops ADD COLUMN printAgentTokenHash VARCHAR(64) NULL`,
      `ALTER TABLE shops ADD COLUMN printAgentTokenPrefix VARCHAR(24) NULL`,
    ]) {
      try {
        await this.shops.query(sql);
      } catch {
        /* already exists */
      }
    }
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw.trim()).digest('hex');
  }

  private extractBearer(authHeader?: string | null): string {
    const raw = String(authHeader ?? '').trim();
    const m = raw.match(/^Bearer\s+(.+)$/i);
    return (m ? m[1] : raw).trim();
  }

  async resolveShopFromToken(authHeader?: string | null): Promise<AgentShop> {
    const token = this.extractBearer(authHeader);
    if (!token.startsWith('pa_') || token.length < 20) {
      throw new UnauthorizedException('Token de comandas inválido');
    }
    const hash = this.hashToken(token);
    const shop = await this.shops.findOne({
      where: { printAgentTokenHash: hash, active: true as any },
      select: ['id', 'name', 'slug', 'timezone', 'printAgentTokenHash'],
    });
    if (!shop) throw new UnauthorizedException('Token de comandas inválido');
    return shop;
  }

  async getAdminStatus(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopManage(user, shopId);
    const shop = await this.shops.findOne({
      where: { id: shopId },
      select: ['id', 'printAgentTokenPrefix', 'printAgentTokenHash'],
    });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return {
      configured: !!shop.printAgentTokenHash,
      tokenPrefix: shop.printAgentTokenPrefix ?? null,
    };
  }

  async generateToken(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopManage(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const token = `pa_${randomBytes(24).toString('base64url')}`;
    shop.printAgentTokenHash = this.hashToken(token);
    shop.printAgentTokenPrefix = `${token.slice(0, 10)}…`;
    await this.shops.save(shop);
    return {
      token,
      tokenPrefix: shop.printAgentTokenPrefix,
      configured: true,
      hint: 'Copiá el token ahora: no se vuelve a mostrar. Pegalo en Comandas.exe → Conexión.',
    };
  }

  async revokeToken(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopManage(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    shop.printAgentTokenHash = null;
    shop.printAgentTokenPrefix = null;
    await this.shops.save(shop);
    return { configured: false, tokenPrefix: null };
  }

  async session(shop: AgentShop) {
    const pending = await this.jobs.count({
      where: { shopId: shop.id, status: 'PENDING' as PrintJobStatus },
    });
    return {
      shopId: shop.id,
      shopName: shop.name,
      shopSlug: shop.slug,
      timezone: shop.timezone,
      pendingJobs: pending,
    };
  }

  async getMenu(shop: AgentShop) {
    const full = await this.shops.findOne({ where: { id: shop.id } });
    if (!full) throw new NotFoundException('Local no encontrado');
    const menus = normalizeShopMenus(full.menu);
    return {
      shopId: shop.id,
      shopName: shop.name,
      menus: menus.map((m) => ({
        id: m.id,
        title: m.title || m.slug || 'Menú',
        sections: (m.sections ?? []).map((sec) => ({
          name: sec.name || 'Sin categoría',
          items: (sec.items ?? [])
            .filter((it) => it?.id && it.available !== false)
            .map((it) => ({
              id: String(it.id),
              name: String(it.name || '').trim() || 'Ítem',
            })),
        })),
      })),
      extras: normalizeOrderingExtras(full.orderingExtras)
        .filter((e) => e.available !== false)
        .map((e) => ({
          id: e.id,
          name: e.name,
          menuItemIds: e.menuItemIds ?? [],
        })),
    };
  }

  async listPendingJobs(shop: AgentShop) {
    const rows = await this.jobs.find({
      where: { shopId: shop.id, status: 'PENDING' as PrintJobStatus },
      order: { createdAt: 'ASC' },
      take: 30,
    });
    return rows.map((j) => ({
      id: j.id,
      kind: j.kind,
      copies: j.copies,
      payload: j.payload,
      createdAt: j.createdAt,
    }));
  }

  async ackJob(
    shop: AgentShop,
    jobId: string,
    body: { status?: string; error?: string | null },
  ) {
    const job = await this.jobs.findOne({ where: { id: jobId, shopId: shop.id } });
    if (!job) throw new NotFoundException('Trabajo no encontrado');
    const status = String(body?.status ?? '').toUpperCase();
    if (status !== 'PRINTED' && status !== 'FAILED') {
      throw new BadRequestException('status debe ser PRINTED o FAILED');
    }
    job.status = status as PrintJobStatus;
    job.error =
      status === 'FAILED'
        ? String(body?.error ?? 'Error de impresión').trim().slice(0, 500) || 'Error de impresión'
        : null;
    job.printedAt = status === 'PRINTED' ? new Date() : job.printedAt ?? null;
    await this.jobs.save(job);
    return { id: job.id, status: job.status };
  }

  async enqueueTest(shop: AgentShop) {
    const job = await this.enqueue({
      shopId: shop.id,
      kind: 'TEST',
      sourceId: `test_${Date.now()}_${randomBytes(4).toString('hex')}`,
      copies: 1,
      payload: {
        kind: 'TEST',
        shopName: shop.name,
        subtitle: 'PRUEBA DE COMANDA',
        guestName: 'Prueba',
        code: 'TEST',
      },
    });
    return { id: job.id, kind: job.kind };
  }

  async enqueueCustomerOrder(
    shop: Shop,
    order: CustomerOrder,
    reason: 'ACCEPTED' | 'COUNTER' | 'TABLE',
    opts?: {
      printCustomerTicket?: boolean;
      printKitchen?: boolean;
      tableLabel?: string | null;
      waiterName?: string | null;
      /** Sufijo para reimprimir ticket cliente (ej. close). */
      customerSourceSuffix?: string;
    },
  ) {
    if (!shop.printAgentTokenHash) return null;
    const fulfillment = String(order.fulfillment || '');
    const channelLabel =
      fulfillment === CustomerOrderFulfillment.COUNTER
        ? 'MOSTRADOR'
        : fulfillment === CustomerOrderFulfillment.TABLE
          ? 'MESA'
          : fulfillment === CustomerOrderFulfillment.DELIVERY
            ? 'DELIVERY'
            : 'TAKE AWAY';
    const payment =
      order.paymentMethod === CustomerOrderPaymentMethod.TRANSFER ? 'Transferencia' : 'Efectivo';
    const items = (order.items ?? []).map((it) => ({
      menuItemId: it.menuItemId ?? null,
      name: it.name,
      qty: it.qty,
      notes: it.notes ?? null,
      kind: it.kind || 'ITEM',
      removedIngredients: it.removedIngredients ?? [],
      attachedToMenuItemId: it.attachedToMenuItemId ?? null,
      extraId: it.extraId ?? null,
    }));
    const phoneDigits = String(order.phone ?? '').replace(/\D/g, '');
    const phoneOk =
      phoneDigits.length >= 6 && !/^1+$/.test(phoneDigits) && phoneDigits !== '0000000000';
    const tableLabel = opts?.tableLabel?.trim() || null;
    const waiterName = opts?.waiterName?.trim() || null;
    const base = {
      kind: 'CUSTOMER_ORDER' as const,
      shopName: shop.name,
      reason,
      orderId: order.id,
      code: order.code,
      fulfillment,
      guestName: `${order.firstName} ${order.lastName}`.trim(),
      phone: phoneOk ? order.phone : null,
      address: order.address ?? null,
      deliveryZoneName: order.deliveryZoneName ?? null,
      paymentMethod: payment,
      cashAmount: order.cashAmount == null ? null : Number(order.cashAmount),
      customerNotes: order.customerNotes ?? null,
      discountLabel: order.discountLabel ?? null,
      discountAmount: Number(order.discountAmount ?? 0) || 0,
      total: Number(order.total) || 0,
      items,
      createdAt: order.createdAt,
      acceptedAt: order.acceptedAt ?? null,
      tableLabel,
      waiterName,
      salonTableId: order.salonTableId ?? null,
      tableSessionId: order.tableSessionId ?? null,
    };

    const printKitchen = opts?.printKitchen !== false;
    let kitchen: PrintJob | null = null;
    if (printKitchen) {
      kitchen = await this.enqueue({
        shopId: shop.id,
        kind: 'CUSTOMER_ORDER',
        sourceId: `co_${order.id}_${reason}_kitchen`,
        copies: 1,
        payload: {
          ...base,
          ticketType: 'KITCHEN',
          subtitle: tableLabel
            ? `COCINA · ${channelLabel} ${tableLabel}`
            : `COCINA · ${channelLabel}`,
        },
      });
    }

    const wantCustomer =
      (reason === 'COUNTER' &&
        fulfillment === CustomerOrderFulfillment.COUNTER &&
        opts?.printCustomerTicket !== false) ||
      (reason === 'TABLE' &&
        fulfillment === CustomerOrderFulfillment.TABLE &&
        !!opts?.printCustomerTicket);
    if (!wantCustomer) return kitchen;

    const customerSuffix = opts?.customerSourceSuffix
      ? `_${opts.customerSourceSuffix}`
      : '';
    await this.enqueue({
      shopId: shop.id,
      kind: 'CUSTOMER_ORDER',
      sourceId: `co_${order.id}_${reason}_customer${customerSuffix}`,
      copies: 1,
      payload: {
        ...base,
        ticketType: 'CUSTOMER',
        subtitle: tableLabel ? `${channelLabel} ${tableLabel}` : channelLabel,
      },
    });
    return kitchen;
  }

  private async enqueue(input: {
    shopId: string;
    kind: PrintJobKind;
    sourceId: string;
    copies: number;
    payload: Record<string, unknown>;
  }) {
    const existing = await this.jobs.findOne({
      where: { shopId: input.shopId, sourceId: input.sourceId },
    });
    if (existing) return existing;
    const job = await this.jobs.save(
      this.jobs.create({
        shopId: input.shopId,
        kind: input.kind,
        status: 'PENDING',
        sourceId: input.sourceId,
        copies: Math.max(1, Math.min(5, input.copies || 1)),
        payload: input.payload,
        error: null,
        printedAt: null,
      }),
    );
    this.live.tick(input.shopId, 'customer-orders');
    return job;
  }
}
