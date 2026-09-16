import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { GlobalRole } from '../../common/enums';
import { isSuperAdmin } from '../../common/guards';
import {
  deleteUploadIfExists,
  ensureUploadsDir,
  resolveUploadPath,
  saveUploadFile,
  uploadsRoot,
} from '../../common/uploads';
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

export type PrintAgentInstallerOs = 'windows' | 'macos' | 'linux';

type InstallerEntry = {
  os: PrintAgentInstallerOs;
  version: string;
  source: 'file' | 'url';
  originalName: string;
  storedName: string;
  relativePath: string;
  downloadUrl?: string;
  mime: string;
  size: number;
  uploadedAt: string;
};

type InstallerCatalog = {
  items: InstallerEntry[];
};

/** Legacy single-file meta (pre multi-OS). */
type LegacyInstallerMeta = {
  originalName: string;
  storedName: string;
  relativePath: string;
  mime: string;
  size: number;
  uploadedAt: string;
  os?: string;
  version?: string;
};

export type InstallerPublicItem = {
  os: PrintAgentInstallerOs;
  version: string;
  source: 'file' | 'url';
  fileName: string;
  size: number;
  uploadedAt: string;
  /** Solo si source=url: link externo de descarga. */
  downloadUrl?: string;
};

export type InstallerPublicCatalog = {
  items: InstallerPublicItem[];
};

const INSTALLER_DIR = 'platform';
const INSTALLER_META = 'cierres-comandas-installer.meta.json';
const INSTALLER_MAX_BYTES = 180 * 1024 * 1024;
const INSTALLER_OS_LIST: PrintAgentInstallerOs[] = ['windows', 'macos', 'linux'];
const INSTALLER_ALLOWED_EXT_BY_OS: Record<PrintAgentInstallerOs, Set<string>> = {
  windows: new Set(['.exe', '.msi', '.zip']),
  macos: new Set(['.dmg', '.pkg', '.zip']),
  linux: new Set(['.AppImage', '.deb', '.rpm', '.tar.gz', '.zip', '.appimage']),
};

function normalizeInstallerOs(raw: unknown): PrintAgentInstallerOs | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'windows' || v === 'win') return 'windows';
  if (v === 'macos' || v === 'mac' || v === 'darwin' || v === 'osx') return 'macos';
  if (v === 'linux') return 'linux';
  return null;
}

function normalizeInstallerVersion(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^v/i, '')
    .slice(0, 40);
}

function normalizeInstallerDownloadUrl(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  // Drive share/view → link de descarga directa.
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const fileId =
      parsed.searchParams.get('id') ||
      parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ||
      parsed.pathname.match(/\/d\/([^/]+)/)?.[1] ||
      null;
    if (fileId) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
    }
  }

  return parsed.toString().slice(0, 2000);
}

function installerUrlDisplayName(downloadUrl: string, os: PrintAgentInstallerOs): string {
  try {
    const parsed = new URL(downloadUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    if (
      host === 'drive.google.com' ||
      host === 'docs.google.com' ||
      host.includes('googleusercontent.com')
    ) {
      return `Google Drive (${os})`;
    }
    const pathPart = parsed.pathname.split('/').filter(Boolean).pop();
    if (
      pathPart &&
      pathPart !== 'view' &&
      pathPart !== 'uc' &&
      pathPart !== 'open' &&
      pathPart !== 'edit'
    ) {
      return decodeURIComponent(pathPart).slice(0, 180);
    }
  } catch {
    /* ignore */
  }
  return `Cierres-Comandas-${os}`;
}

function installerExt(originalName: string): string {
  const name = originalName.toLowerCase();
  if (name.endsWith('.tar.gz')) return '.tar.gz';
  if (name.endsWith('.appimage')) return '.AppImage';
  const idx = originalName.lastIndexOf('.');
  if (idx < 0) return '';
  return originalName.slice(idx).toLowerCase() === '.appimage'
    ? '.AppImage'
    : originalName.slice(idx).toLowerCase();
}

function installerBasename(os: PrintAgentInstallerOs): string {
  return `cierres-comandas-installer-${os}`;
}

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
      `ALTER TABLE shops ADD COLUMN printAgentToken VARCHAR(120) NULL`,
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
      select: [
        'id',
        'name',
        'slug',
        'timezone',
        'printAgentTokenHash',
        'printAgentToken',
        'printAgentTokenPrefix',
      ],
    });
    if (!shop) throw new UnauthorizedException('Token de comandas inválido');
    // Tokens viejos solo tenían hash: si el agent autentica, guardamos el claro para poder copiarlo.
    if (!shop.printAgentToken?.trim()) {
      try {
        await this.shops.update(shop.id, {
          printAgentToken: token,
          printAgentTokenPrefix: shop.printAgentTokenPrefix || `${token.slice(0, 10)}…`,
        });
      } catch {
        /* no bloquear el agent si falla el backfill */
      }
    }
    return shop;
  }

  async getAdminStatus(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({
      where: { id: shopId },
      select: ['id', 'printAgentTokenPrefix', 'printAgentTokenHash', 'printAgentToken'],
    });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const token = shop.printAgentToken?.trim() || null;
    return {
      configured: !!shop.printAgentTokenHash,
      tokenPrefix: shop.printAgentTokenPrefix ?? null,
      token,
      canReveal: !!token,
    };
  }

  async generateToken(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopManage(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const token = `pa_${randomBytes(24).toString('base64url')}`;
    shop.printAgentTokenHash = this.hashToken(token);
    shop.printAgentTokenPrefix = `${token.slice(0, 10)}…`;
    shop.printAgentToken = token;
    await this.shops.save(shop);
    return {
      token,
      tokenPrefix: shop.printAgentTokenPrefix,
      configured: true,
      canReveal: true,
      hint: 'Token listo. Podés copiarlo cuando quieras desde Dispositivos.',
    };
  }

  async revokeToken(user: AuthUser, shopId: string) {
    this.shopsSvc.assertShopManage(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    shop.printAgentTokenHash = null;
    shop.printAgentTokenPrefix = null;
    shop.printAgentToken = null;
    await this.shops.save(shop);
    return { configured: false, tokenPrefix: null, token: null, canReveal: false };
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

  /** Ticket cliente de toda la sesión de mesa (varios envíos + descuento). */
  async enqueueTableSessionTicket(
    shop: Shop,
    input: {
      sessionId: string;
      code: string;
      items: Array<Record<string, unknown>>;
      subtotal: number;
      discountAmount: number;
      discountLabel?: string | null;
      total: number;
      tableLabel?: string | null;
      waiterName?: string | null;
      covers?: number;
    },
  ) {
    if (!shop.printAgentTokenHash) return null;
    const tableLabel = input.tableLabel?.trim() || null;
    const waiterName = input.waiterName?.trim() || null;
    const suffix = Date.now().toString(36);
    return this.enqueue({
      shopId: shop.id,
      kind: 'CUSTOMER_ORDER',
      sourceId: `ts_${input.sessionId}_customer_${suffix}`,
      copies: 1,
      payload: {
        kind: 'CUSTOMER_ORDER',
        ticketType: 'CUSTOMER',
        shopName: shop.name,
        reason: 'TABLE',
        orderId: input.sessionId,
        code: input.code,
        fulfillment: 'TABLE',
        guestName: tableLabel ? `Mesa ${tableLabel}` : 'Mesa',
        phone: null,
        address: null,
        deliveryZoneName: null,
        paymentMethod: null,
        cashAmount: null,
        customerNotes:
          input.covers && input.covers > 0 ? `${input.covers} comensales` : null,
        discountLabel: input.discountLabel ?? null,
        discountAmount: Number(input.discountAmount) || 0,
        total: Number(input.total) || 0,
        items: input.items,
        createdAt: new Date().toISOString(),
        acceptedAt: null,
        tableLabel,
        waiterName,
        salonTableId: null,
        tableSessionId: input.sessionId,
        subtitle: tableLabel ? `MESA ${tableLabel}` : 'MESA',
      },
    });
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

  private assertSuperAdmin(user: AuthUser) {
    if (!isSuperAdmin(user.globalRole as GlobalRole)) {
      throw new ForbiddenException('Solo un super admin puede gestionar el instalador');
    }
  }

  private installerMetaPath(): string {
    return join(uploadsRoot(), INSTALLER_DIR, INSTALLER_META);
  }

  private toPublicItem(entry: InstallerEntry): InstallerPublicItem {
    return {
      os: entry.os,
      version: entry.version,
      source: entry.source,
      fileName: entry.originalName,
      size: entry.size,
      uploadedAt: entry.uploadedAt,
      ...(entry.source === 'url' && entry.downloadUrl
        ? { downloadUrl: entry.downloadUrl }
        : {}),
    };
  }

  private readInstallerCatalog(): InstallerCatalog {
    const abs = this.installerMetaPath();
    if (!existsSync(abs)) return { items: [] };
    try {
      const raw = JSON.parse(readFileSync(abs, 'utf8')) as InstallerCatalog | LegacyInstallerMeta;
      if (raw && Array.isArray((raw as InstallerCatalog).items)) {
        const items = (raw as InstallerCatalog).items
          .map((item) => this.normalizeCatalogEntry(item))
          .filter((x): x is InstallerEntry => !!x);
        return { items: this.dedupeByOs(items) };
      }
      const legacy = this.normalizeLegacyEntry(raw as LegacyInstallerMeta);
      if (!legacy) return { items: [] };
      const catalog: InstallerCatalog = { items: [legacy] };
      this.writeInstallerCatalog(catalog);
      return catalog;
    } catch {
      return { items: [] };
    }
  }

  private normalizeCatalogEntry(raw: Partial<InstallerEntry> | null | undefined): InstallerEntry | null {
    if (!raw) return null;
    const os = normalizeInstallerOs(raw.os) ?? 'windows';
    const version = normalizeInstallerVersion(raw.version) || '0.0.0';
    const source: 'file' | 'url' =
      raw.source === 'url' || (!!raw.downloadUrl && !raw.relativePath) ? 'url' : 'file';
    if (source === 'url') {
      const downloadUrl = normalizeInstallerDownloadUrl(raw.downloadUrl);
      if (!downloadUrl) return null;
      const osNorm = os;
      return {
        os: osNorm,
        version,
        source: 'url',
        originalName: installerUrlDisplayName(
          downloadUrl,
          osNorm,
        ),
        storedName: '',
        relativePath: '',
        downloadUrl,
        mime: 'application/octet-stream',
        size: Number(raw.size) || 0,
        uploadedAt: String(raw.uploadedAt || new Date().toISOString()),
      };
    }
    if (!raw.relativePath || !raw.originalName) return null;
    if (!resolveUploadPath(raw.relativePath)) return null;
    return {
      os,
      version,
      source: 'file',
      originalName: String(raw.originalName).slice(0, 180),
      storedName: String(raw.storedName || ''),
      relativePath: String(raw.relativePath),
      mime: String(raw.mime || 'application/octet-stream'),
      size: Number(raw.size) || 0,
      uploadedAt: String(raw.uploadedAt || new Date().toISOString()),
    };
  }

  private normalizeLegacyEntry(raw: LegacyInstallerMeta | null | undefined): InstallerEntry | null {
    if (!raw?.relativePath || !raw?.originalName) return null;
    if (!resolveUploadPath(raw.relativePath)) return null;
    return {
      os: normalizeInstallerOs(raw.os) ?? 'windows',
      version: normalizeInstallerVersion(raw.version) || '0.0.0',
      source: 'file',
      originalName: String(raw.originalName).slice(0, 180),
      storedName: String(raw.storedName || ''),
      relativePath: String(raw.relativePath),
      mime: String(raw.mime || 'application/octet-stream'),
      size: Number(raw.size) || 0,
      uploadedAt: String(raw.uploadedAt || new Date().toISOString()),
    };
  }

  private dedupeByOs(items: InstallerEntry[]): InstallerEntry[] {
    const map = new Map<PrintAgentInstallerOs, InstallerEntry>();
    for (const item of items) map.set(item.os, item);
    return INSTALLER_OS_LIST.map((os) => map.get(os)).filter((x): x is InstallerEntry => !!x);
  }

  private writeInstallerCatalog(catalog: InstallerCatalog): void {
    ensureUploadsDir(INSTALLER_DIR);
    writeFileSync(
      this.installerMetaPath(),
      JSON.stringify({ items: this.dedupeByOs(catalog.items) }, null, 2),
      'utf8',
    );
  }

  private findInstallerEntry(os: PrintAgentInstallerOs): InstallerEntry | null {
    return this.readInstallerCatalog().items.find((x) => x.os === os) ?? null;
  }

  getInstallerMetaPublic(): InstallerPublicCatalog {
    return {
      items: this.readInstallerCatalog().items.map((x) => this.toPublicItem(x)),
    };
  }

  getInstallerMetaAdmin(user: AuthUser) {
    this.assertSuperAdmin(user);
    return this.getInstallerMetaPublic();
  }

  uploadInstaller(
    user: AuthUser,
    file?: Express.Multer.File,
    opts?: { os?: string; version?: string },
  ) {
    this.assertSuperAdmin(user);
    const os = normalizeInstallerOs(opts?.os);
    if (!os) {
      throw new BadRequestException('Elegí el sistema operativo (windows, macos o linux)');
    }
    const version = normalizeInstallerVersion(opts?.version);
    if (!version) {
      throw new BadRequestException('Indicá la versión del instalador');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('Seleccioná el archivo del instalador');
    }
    if (file.size > INSTALLER_MAX_BYTES) {
      throw new BadRequestException('El instalador supera el tamaño máximo (180 MB)');
    }
    const originalName =
      String(file.originalname ?? `Cierres-Comandas-${os}`).trim() || `Cierres-Comandas-${os}`;
    const ext = installerExt(originalName);
    const allowed = INSTALLER_ALLOWED_EXT_BY_OS[os];
    if (!ext || (!allowed.has(ext) && !allowed.has(ext.toLowerCase()))) {
      const hint =
        os === 'windows'
          ? '.exe, .msi o .zip'
          : os === 'macos'
            ? '.dmg, .pkg o .zip'
            : '.AppImage, .deb, .rpm, .tar.gz o .zip';
      throw new BadRequestException(`Para ${os} solo se aceptan ${hint}`);
    }

    const catalog = this.readInstallerCatalog();
    const prev = catalog.items.find((x) => x.os === os);
    if (prev?.source === 'file' && prev.relativePath) deleteUploadIfExists(prev.relativePath);

    const saved = saveUploadFile({
      relativeDir: INSTALLER_DIR,
      basename: installerBasename(os),
      buffer: file.buffer,
      originalName,
      mime: file.mimetype,
    });
    const entry: InstallerEntry = {
      os,
      version,
      source: 'file',
      originalName: originalName.slice(0, 180),
      storedName: saved.fileName,
      relativePath: saved.relativePath,
      mime: file.mimetype || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };
    const nextItems = catalog.items.filter((x) => x.os !== os).concat(entry);
    this.writeInstallerCatalog({ items: nextItems });
    return this.getInstallerMetaPublic();
  }

  setInstallerUrl(
    user: AuthUser,
    opts?: { os?: string; version?: string; downloadUrl?: string },
  ) {
    this.assertSuperAdmin(user);
    const os = normalizeInstallerOs(opts?.os);
    if (!os) {
      throw new BadRequestException('Elegí el sistema operativo (windows, macos o linux)');
    }
    const version = normalizeInstallerVersion(opts?.version);
    if (!version) {
      throw new BadRequestException('Indicá la versión del instalador');
    }
    const downloadUrl = normalizeInstallerDownloadUrl(opts?.downloadUrl);
    if (!downloadUrl) {
      throw new BadRequestException('Indicá un link de descarga válido (http o https)');
    }

    const catalog = this.readInstallerCatalog();
    const prev = catalog.items.find((x) => x.os === os);
    if (prev?.source === 'file' && prev.relativePath) deleteUploadIfExists(prev.relativePath);

    const entry: InstallerEntry = {
      os,
      version,
      source: 'url',
      originalName: installerUrlDisplayName(downloadUrl, os),
      storedName: '',
      relativePath: '',
      downloadUrl,
      mime: 'application/octet-stream',
      size: 0,
      uploadedAt: new Date().toISOString(),
    };
    const nextItems = catalog.items.filter((x) => x.os !== os).concat(entry);
    this.writeInstallerCatalog({ items: nextItems });
    return this.getInstallerMetaPublic();
  }

  deleteInstaller(user: AuthUser, osRaw?: string) {
    this.assertSuperAdmin(user);
    const os = normalizeInstallerOs(osRaw);
    if (!os) {
      throw new BadRequestException('Indicá el sistema operativo a quitar');
    }
    const catalog = this.readInstallerCatalog();
    const prev = catalog.items.find((x) => x.os === os);
    if (prev?.source === 'file' && prev?.relativePath) deleteUploadIfExists(prev.relativePath);
    const nextItems = catalog.items.filter((x) => x.os !== os);
    if (nextItems.length === 0) {
      try {
        const absMeta = this.installerMetaPath();
        if (existsSync(absMeta)) unlinkSync(absMeta);
      } catch {
        /* ignore */
      }
      return this.getInstallerMetaPublic();
    }
    this.writeInstallerCatalog({ items: nextItems });
    return this.getInstallerMetaPublic();
  }

  async downloadInstallerForShop(user: AuthUser, shopId: string, osRaw?: string) {
    this.shopsSvc.assertShopManage(user, shopId);
    return this.resolveInstallerDownload(osRaw);
  }

  downloadInstallerAdmin(user: AuthUser, osRaw?: string) {
    this.assertSuperAdmin(user);
    return this.resolveInstallerDownload(osRaw);
  }

  private resolveInstallerDownload(osRaw?: string): {
    kind: 'file';
    buffer: Buffer;
    fileName: string;
    contentType: string;
  } | {
    kind: 'url';
    url: string;
  } {
    const os = normalizeInstallerOs(osRaw);
    if (!os) throw new BadRequestException('Indicá el sistema operativo');
    const meta = this.findInstallerEntry(os);
    if (!meta) throw new NotFoundException(`Todavía no hay instalador para ${os}`);
    if (meta.source === 'url' && meta.downloadUrl) {
      const url = normalizeInstallerDownloadUrl(meta.downloadUrl) || meta.downloadUrl;
      return { kind: 'url', url };
    }
    const abs = resolveUploadPath(meta.relativePath);
    if (!abs) throw new NotFoundException(`Todavía no hay instalador para ${os}`);
    return {
      kind: 'file',
      buffer: readFileSync(abs),
      fileName: meta.originalName || meta.storedName,
      contentType: meta.mime || 'application/octet-stream',
    };
  }
}
