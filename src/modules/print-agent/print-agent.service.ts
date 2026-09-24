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
import { In, Repository } from 'typeorm';
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
import { normalizeShopMenus, normalizeKitchenSectors, normalizeKitchenSectorIds } from '../menu/menu-parse.util';
import { normalizeOrderingExtras } from '../../common/shop-ordering';

type AgentShop = Pick<Shop, 'id' | 'name' | 'slug' | 'timezone' | 'printAgentTokenHash'>;

const MAX_PRINTED_KEYS = 40;

type KitchenPayloadItem = {
  menuItemId: string | null;
  name: string;
  qty: number;
  notes: string | null;
  kind: string;
  removedIngredients: string[];
  attachedToMenuItemId: string | null;
  extraId: string | null;
  isEntrada: boolean;
  mainFired: boolean;
  combinesWithNames: string[];
};

function isExtraKind(kind: string): boolean {
  return String(kind || '').toUpperCase() === 'EXTRA';
}

/** Filtra líneas de cocina para entradas o principales pendientes. */
function filterKitchenPayloadItems(
  items: KitchenPayloadItem[],
  mode: 'ALL' | 'ENTRADAS' | 'MAINS_PENDING',
): KitchenPayloadItem[] {
  if (mode === 'ALL' || !items.length) return items;
  const keepIds = new Set<string>();
  for (const it of items) {
    if (isExtraKind(it.kind)) continue;
    const id = String(it.menuItemId || '').trim();
    if (mode === 'ENTRADAS') {
      if (it.isEntrada && id) keepIds.add(id);
    } else if (!it.isEntrada && !it.mainFired && id) {
      keepIds.add(id);
    }
  }
  if (!keepIds.size) return [];
  return items.filter((it) => {
    if (isExtraKind(it.kind)) {
      const parent = String(it.attachedToMenuItemId || '').trim();
      return !!parent && keepIds.has(parent);
    }
    const id = String(it.menuItemId || '').trim();
    return !!id && keepIds.has(id);
  });
}

function mergePrintedKeys(
  payload: Record<string, unknown> | null | undefined,
  incoming?: unknown,
): Record<string, unknown> {
  const prev = Array.isArray(payload?.['printedKeys']) ? payload['printedKeys'] : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const seen = new Set<string>();
  const printedKeys: string[] = [];
  for (const raw of [...prev, ...next]) {
    const key = String(raw ?? '').trim().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    printedKeys.push(key);
    if (printedKeys.length >= MAX_PRINTED_KEYS) break;
  }
  return { ...(payload && typeof payload === 'object' ? payload : {}), printedKeys };
}

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

/** Cuántos jobs reserva cada poll. El agent los imprime en serie en el mismo tick. */
const CLAIM_BATCH = 8;
/** Si el agent se cae a mitad de impresión, el job vuelve a la cola. */
const STALE_CLAIM_SECONDS = 180;

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

function isGoogleDriveHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, '');
  return (
    host === 'drive.google.com' ||
    host === 'docs.google.com' ||
    host.endsWith('.googleusercontent.com')
  );
}

function extractDriveConfirmToken(html: string): string | null {
  const patterns = [
    /confirm=([0-9A-Za-z_-]+)/,
    /name="confirm"\s+value="([^"]+)"/,
    /"confirm"\s*,\s*"([0-9A-Za-z_-]+)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1] && m[1] !== 't') return m[1];
  }
  return null;
}

function extractDriveWarningCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const m = setCookie.match(/download_warning[^=]*=([^;]+)/i);
  return m?.[1]?.trim() || null;
}

/**
 * Baja el instalador desde un link (p.ej. Google Drive).
 * Drive en archivos grandes muestra un HTML de “aviso de virus”; sin el confirm
 * el navegador guarda HTML como .exe y Windows dice que no se puede ejecutar.
 */
async function fetchInstallerFromUrl(
  downloadUrl: string,
  fileNameHint: string,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const maxBytes = 180 * 1024 * 1024;
  let url = downloadUrl;
  let cookieHeader: string | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    if (!res.ok) {
      throw new BadRequestException(
        `No se pudo bajar el instalador desde el link (HTTP ${res.status}). Probá subir el archivo en Locales.`,
      );
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      throw new BadRequestException('El instalador supera el tamaño máximo (180 MB)');
    }

    const setCookie = res.headers.get('set-cookie');
    const warning = extractDriveWarningCookie(setCookie);
    if (warning) {
      cookieHeader = cookieHeader
        ? `${cookieHeader}; download_warning=${warning}`
        : `download_warning=${warning}`;
    }

    if (contentType.includes('text/html')) {
      const html = await res.text();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new BadRequestException('Link de instalador inválido');
      }
      if (!isGoogleDriveHost(parsed.hostname)) {
        throw new BadRequestException(
          'El link no devolvió un archivo. Subí el instalador como archivo en Locales.',
        );
      }
      const fileId = parsed.searchParams.get('id');
      const confirm =
        extractDriveConfirmToken(html) ||
        warning ||
        't';
      if (!fileId) {
        throw new BadRequestException(
          'No se pudo resolver el archivo de Google Drive. Subí el instalador como archivo en Locales.',
        );
      }
      url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=${encodeURIComponent(confirm)}`;
      continue;
    }

    const ab = await res.arrayBuffer();
    if (ab.byteLength < 1024) {
      throw new BadRequestException(
        'La descarga del instalador quedó vacía. Subí el archivo en Locales.',
      );
    }
    if (ab.byteLength > maxBytes) {
      throw new BadRequestException('El instalador supera el tamaño máximo (180 MB)');
    }
    const buffer = Buffer.from(ab);
    // MZ = PE Windows; ZIP/DMG también suelen empezar distinto de HTML.
    const head = buffer.subarray(0, 15).toString('utf8').toLowerCase();
    if (head.includes('<!doctype') || head.includes('<html')) {
      throw new BadRequestException(
        'Google Drive devolvió una página en vez del .exe. Subí el instalador como archivo en Locales.',
      );
    }
    const disposition = res.headers.get('content-disposition') || '';
    const fromHeader = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1];
    const fileName = decodeURIComponent(
      (fromHeader || fileNameHint || 'Cierres-Comandas-windows.exe').replace(/["']/g, ''),
    ).slice(0, 180);
    return {
      buffer,
      fileName,
      contentType: contentType || 'application/octet-stream',
    };
  }

  throw new BadRequestException(
    'No se pudo bajar el instalador desde el link. Subí el archivo en Locales.',
  );
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
          attempts INT NOT NULL DEFAULT 0,
          claimToken VARCHAR(64) NULL,
          claimedAt DATETIME(6) NULL,
          payload JSON NOT NULL,
          error VARCHAR(500) NULL,
          printedAt DATETIME(6) NULL,
          PRIMARY KEY (id),
          UNIQUE KEY idx_print_jobs_shop_source (shopId, sourceId),
          KEY idx_print_jobs_shop_status (shopId, status, createdAt),
          KEY idx_print_jobs_claim_token (shopId, claimToken)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch {
      /* already exists / dialect */
    }
    for (const sql of [
      `ALTER TABLE print_jobs ADD COLUMN attempts INT NOT NULL DEFAULT 0`,
      `ALTER TABLE print_jobs ADD COLUMN claimToken VARCHAR(64) NULL`,
      `ALTER TABLE print_jobs ADD COLUMN claimedAt DATETIME(6) NULL`,
      `ALTER TABLE print_jobs ADD KEY idx_print_jobs_claim_token (shopId, claimToken)`,
    ]) {
      try {
        await this.jobs.query(sql);
      } catch {
        /* already exists */
      }
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
    try {
      await this.shops.query(`
        UPDATE shops
        SET
          printAgentTokenHash = SHA2(TRIM(printAgentToken), 256),
          printAgentTokenPrefix = IFNULL(
            NULLIF(printAgentTokenPrefix, ''),
            CONCAT(LEFT(TRIM(printAgentToken), 10), '…')
          )
        WHERE printAgentToken IS NOT NULL
          AND TRIM(printAgentToken) <> ''
          AND (printAgentTokenHash IS NULL OR printAgentTokenHash = '')
      `);
    } catch {
      /* columna ausente */
    }
    try {
      await this.shops.query(`UPDATE shops SET printAgentToken = NULL WHERE printAgentToken IS NOT NULL`);
    } catch {
      /* columna ausente */
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
    this.shopsSvc.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({
      where: { id: shopId },
      select: ['id', 'printAgentTokenPrefix', 'printAgentTokenHash'],
    });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return {
      configured: !!shop.printAgentTokenHash,
      tokenPrefix: shop.printAgentTokenPrefix ?? null,
      token: null,
      canReveal: false,
    };
  }

  async generateToken(user: AuthUser, shopId: string) {
    // Ver o Todo en Comanderas: el cajero puede regenerar para pegar en el exe.
    this.shopsSvc.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const token = `pa_${randomBytes(24).toString('base64url')}`;
    shop.printAgentTokenHash = this.hashToken(token);
    shop.printAgentTokenPrefix = `${token.slice(0, 10)}…`;
    shop.printAgentToken = null;
    await this.shops.save(shop);
    return {
      token,
      tokenPrefix: shop.printAgentTokenPrefix,
      configured: true,
      canReveal: false,
      hint: 'Copiá el token ahora y pegalo en Cierres-Comandas. Después no se puede ver: hay que regenerarlo.',
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
      where: {
        shopId: shop.id,
        status: In(['PENDING', 'CLAIMED'] as PrintJobStatus[]),
      },
    });
    return {
      shopId: shop.id,
      shopName: shop.name,
      shopSlug: shop.slug,
      timezone: shop.timezone,
      pendingJobs: pending,
      installer: this.getInstallerMetaPublic(),
    };
  }

  async getMenu(shop: AgentShop) {
    const full = await this.shops.findOne({ where: { id: shop.id } });
    if (!full) throw new NotFoundException('Local no encontrado');
    const menus = normalizeShopMenus(full.menu);
    const kitchenSectors = normalizeKitchenSectors(full.kitchenSectors);
    return {
      shopId: shop.id,
      shopName: shop.name,
      kitchenSectors,
      menus: menus.map((m) => ({
        id: m.id,
        title: m.title || m.slug || 'Menú',
        sections: (m.sections ?? []).map((sec) => ({
          name: sec.name || 'Sin categoría',
          items: (sec.items ?? [])
            .filter((it) => it?.id && it.available !== false)
            .map((it) => {
              const kitchenSectorIds = normalizeKitchenSectorIds(it);
              return {
                id: String(it.id),
                name: String(it.name || '').trim() || 'Ítem',
                kitchenSectorIds,
                kitchenSectorId: kitchenSectorIds[0] ?? null,
              };
            }),
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

  /** Mapa menuItemId → kitchenSectorIds desde la carta del local. */
  private kitchenSectorsByMenuItem(shop: { menu?: unknown }): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const m of normalizeShopMenus(shop.menu)) {
      for (const sec of m.sections ?? []) {
        for (const it of sec.items ?? []) {
          const id = String(it.id ?? '').trim();
          const ids = normalizeKitchenSectorIds(it);
          if (id && ids.length) map.set(id, ids);
        }
      }
    }
    return map;
  }

  private sectorNameById(shop: { kitchenSectors?: unknown }, sectorId: string | null | undefined) {
    const sid = String(sectorId ?? '').trim();
    if (!sid) return null;
    const hit = normalizeKitchenSectors(shop.kitchenSectors).find((s) => s.id === sid);
    return hit?.name ?? null;
  }

  private withKitchenSectorsOnItems<
    T extends { menuItemId?: string | null; attachedToMenuItemId?: string | null },
  >(
    shop: { menu?: unknown; kitchenSectors?: unknown },
    items: T[],
  ): Array<
    T & {
      kitchenSectorIds: string[];
      kitchenSectorNames: string[];
      kitchenSectorId: string | null;
      kitchenSectorName: string | null;
    }
  > {
    const byItem = this.kitchenSectorsByMenuItem(shop);
    return items.map((it) => {
      const key =
        String(it.attachedToMenuItemId ?? '').trim() || String(it.menuItemId ?? '').trim();
      const kitchenSectorIds = (key && byItem.get(key)) || [];
      const kitchenSectorNames = kitchenSectorIds
        .map((sid) => this.sectorNameById(shop, sid))
        .filter((n): n is string => !!n);
      return {
        ...it,
        kitchenSectorIds,
        kitchenSectorNames,
        kitchenSectorId: kitchenSectorIds[0] ?? null,
        kitchenSectorName: kitchenSectorNames[0] ?? null,
      };
    });
  }

  async listPendingJobs(shop: AgentShop) {
    await this.releaseStaleClaims(shop.id);
    const claimToken = randomBytes(16).toString('hex');
    await this.jobs.query(
      `
      UPDATE print_jobs
      SET status = ?, claimToken = ?, claimedAt = NOW(6), updatedAt = NOW(6)
      WHERE shopId = ?
        AND status = ?
        AND deletedAt IS NULL
        AND active = 1
      ORDER BY createdAt ASC
      LIMIT ${CLAIM_BATCH}
      `,
      ['CLAIMED', claimToken, shop.id, 'PENDING'],
    );
    const rows = await this.jobs.find({
      where: { shopId: shop.id, status: 'CLAIMED' as PrintJobStatus, claimToken },
      order: { createdAt: 'ASC' },
    });
    return rows.map((j) => ({
      id: j.id,
      kind: j.kind,
      copies: j.copies,
      payload: j.payload,
      createdAt: j.createdAt,
    }));
  }

  private async releaseStaleClaims(shopId: string) {
    await this.jobs.query(
      `
      UPDATE print_jobs
      SET status = ?, claimToken = NULL, claimedAt = NULL, updatedAt = NOW(6)
      WHERE shopId = ?
        AND status = ?
        AND deletedAt IS NULL
        AND claimedAt IS NOT NULL
        AND claimedAt < DATE_SUB(NOW(6), INTERVAL ${STALE_CLAIM_SECONDS} SECOND)
      `,
      ['PENDING', shopId, 'CLAIMED'],
    );
  }

  async ackJob(
    shop: AgentShop,
    jobId: string,
    body: { status?: string; error?: string | null; printedKeys?: string[] },
  ) {
    const job = await this.jobs.findOne({ where: { id: jobId, shopId: shop.id } });
    if (!job) throw new NotFoundException('Trabajo no encontrado');
    const status = String(body?.status ?? '').toUpperCase();
    if (status !== 'PRINTED' && status !== 'FAILED') {
      throw new BadRequestException('status debe ser PRINTED o FAILED');
    }
    job.payload = mergePrintedKeys(job.payload, body?.printedKeys);
    if (job.status === 'PRINTED') {
      return { id: job.id, status: job.status, attempts: job.attempts ?? 0 };
    }
    if (status === 'PRINTED') {
      job.status = 'PRINTED';
      job.error = null;
      job.printedAt = new Date();
      job.claimToken = null;
      job.claimedAt = null;
      await this.jobs.save(job);
      return { id: job.id, status: job.status, attempts: job.attempts ?? 0 };
    }

    if (job.status === 'FAILED') {
      return { id: job.id, status: job.status, attempts: job.attempts ?? 0 };
    }

    const msg =
      String(body?.error ?? 'Error de impresión').trim().slice(0, 500) ||
      'Error de impresión';
    const attempts = Math.max(0, Number(job.attempts) || 0) + 1;
    job.attempts = attempts;
    job.error = msg;
    job.claimToken = null;
    job.claimedAt = null;
    // Hasta 3 intentos: vuelve a PENDING para que el agent reintente
    // (las comanderas en payload.printedKeys no se vuelven a cortar).
    if (attempts < 3) {
      job.status = 'PENDING';
    } else {
      job.status = 'FAILED';
    }
    await this.jobs.save(job);
    this.live.tick(shop.id, 'customer-orders');
    return { id: job.id, status: job.status, attempts: job.attempts };
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
      /** Sufijo para reimprimir cocina (fuerza nuevo job). */
      kitchenSourceSuffix?: string;
      /** Filtra ítems de cocina: ALL (default), solo entradas, o principales pendientes. */
      kitchenItemsMode?: 'ALL' | 'ENTRADAS' | 'MAINS_PENDING';
      /** Cabecera extra en ticket de cocina (ej. PRINCIPALES). */
      kitchenBanner?: string | null;
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
      order.paymentMethodName?.trim() ||
      (order.paymentMethod === CustomerOrderPaymentMethod.TRANSFER
        ? 'Transferencia'
        : order.paymentMethod === CustomerOrderPaymentMethod.CARD
          ? 'Tarjeta'
          : 'Efectivo');
    const rawItems = (order.items ?? []).map((it) => ({
      menuItemId: it.menuItemId ?? null,
      name: it.name,
      qty: it.qty,
      notes: it.notes ?? null,
      kind: it.kind || 'ITEM',
      removedIngredients: it.removedIngredients ?? [],
      attachedToMenuItemId: it.attachedToMenuItemId ?? null,
      extraId: it.extraId ?? null,
      isEntrada: !!it.isEntrada,
      mainFired: !!it.mainFired,
      combinesWithNames: Array.isArray(it.combinesWithNames)
        ? it.combinesWithNames.map((n) => String(n || '').trim()).filter(Boolean)
        : [],
    }));
    const filtered = filterKitchenPayloadItems(rawItems, opts?.kitchenItemsMode ?? 'ALL');
    if ((opts?.kitchenItemsMode === 'ENTRADAS' || opts?.kitchenItemsMode === 'MAINS_PENDING') && !filtered.length) {
      return null;
    }
    const items = this.withKitchenSectorsOnItems(shop, filtered);
    const phoneDigits = String(order.phone ?? '').replace(/\D/g, '');
    const phoneOk =
      phoneDigits.length >= 6 && !/^1+$/.test(phoneDigits) && phoneDigits !== '0000000000';
    const tableLabel = opts?.tableLabel?.trim() || null;
    const waiterName = opts?.waiterName?.trim() || null;
    const banner = String(opts?.kitchenBanner ?? '').trim() || null;
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
      kitchenBanner: banner,
    };

    const printKitchen = opts?.printKitchen !== false;
    let kitchen: PrintJob | null = null;
    if (printKitchen) {
      const kitchenSuffix = opts?.kitchenSourceSuffix
        ? `_${opts.kitchenSourceSuffix}`
        : '';
      const modeSuffix =
        opts?.kitchenItemsMode && opts.kitchenItemsMode !== 'ALL'
          ? `_${opts.kitchenItemsMode.toLowerCase()}`
          : '';
      kitchen = await this.enqueue({
        shopId: shop.id,
        kind: 'CUSTOMER_ORDER',
        sourceId: `co_${order.id}_${reason}_kitchen${modeSuffix}${kitchenSuffix}`,
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

  /**
   * Reencola comanda de cocina (nuevo job). Sirve si falló o si hay que reimprimir.
   * También reabre FAILED del source canónico a PENDING.
   */
  async reprintKitchenForOrder(
    shop: Shop,
    order: CustomerOrder,
    opts?: { tableLabel?: string | null; waiterName?: string | null; reason?: 'TABLE' | 'COUNTER' | 'ACCEPTED' },
  ) {
    if (!shop.printAgentTokenHash) {
      throw new BadRequestException(
        'Print agent no configurado. Configuralo en Comanderas.',
      );
    }
    const reason = opts?.reason ?? 'TABLE';
    const canonical = `co_${order.id}_${reason}_kitchen`;
    const existing = await this.jobs.findOne({
      where: { shopId: shop.id, sourceId: canonical },
    });
    if (existing && (existing.status === 'FAILED' || existing.status === 'PRINTED')) {
      // Nuevo job con payload fresco (FAILED no reusa el viejo; PRINTED reimprime).
      const job = await this.enqueueCustomerOrder(shop, order, reason, {
        printKitchen: true,
        printCustomerTicket: false,
        tableLabel: opts?.tableLabel ?? null,
        waiterName: opts?.waiterName ?? null,
        kitchenSourceSuffix: `r${Date.now().toString(36)}`,
      });
      if (!job) {
        throw new BadRequestException('No se pudo encolar la comanda');
      }
      return { id: job.id, status: job.status, reused: false };
    }
    if (existing && (existing.status === 'PENDING' || existing.status === 'CLAIMED')) {
      return { id: existing.id, status: existing.status, reused: true };
    }
    const job = await this.enqueueCustomerOrder(shop, order, reason, {
      printKitchen: true,
      printCustomerTicket: false,
      tableLabel: opts?.tableLabel ?? null,
      waiterName: opts?.waiterName ?? null,
    });
    if (!job) {
      throw new BadRequestException('No se pudo encolar la comanda');
    }
    return { id: job.id, status: job.status, reused: false };
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
      promoBreakdown?: {
        promoName: string;
        packs: number;
        packPrice: number;
        packsTotal: number;
        applied?: Array<{
          promoId?: string;
          promoName: string;
          packs: number;
          packPrice?: number;
          packsTotal: number;
        }>;
        outside: Array<{
          name: string;
          qty: number;
          unitPrice: number;
          amount: number;
          kind: string;
        }>;
        outsideTotal: number;
        soldPromoTotal: number;
        baseTotal: number;
      } | null;
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
        promoBreakdown: input.promoBreakdown ?? null,
        items: this.withKitchenSectorsOnItems(
          shop,
          input.items as Array<{
            menuItemId?: string | null;
            attachedToMenuItemId?: string | null;
            [k: string]: unknown;
          }>,
        ),
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
        attempts: 0,
        claimToken: null,
        claimedAt: null,
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

  getAgentUpdate(osRaw?: string) {
    const os = normalizeInstallerOs(osRaw) ?? 'windows';
    const entry = this.findInstallerEntry(os);
    if (!entry) {
      return { os, available: false, version: null as string | null };
    }
    return { available: true, ...this.toPublicItem(entry) };
  }

  downloadInstallerForAgent(osRaw?: string) {
    return this.resolveInstallerDownload(osRaw);
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
    this.shopsSvc.assertShopAccess(user, shopId);
    return this.resolveInstallerDownload(osRaw);
  }

  async downloadInstallerAdmin(user: AuthUser, osRaw?: string) {
    this.assertSuperAdmin(user);
    return this.resolveInstallerDownload(osRaw);
  }

  private async resolveInstallerDownload(osRaw?: string): Promise<{
    kind: 'file';
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    const os = normalizeInstallerOs(osRaw);
    if (!os) throw new BadRequestException('Indicá el sistema operativo');
    const meta = this.findInstallerEntry(os);
    if (!meta) throw new NotFoundException(`Todavía no hay instalador para ${os}`);
    if (meta.source === 'url' && meta.downloadUrl) {
      const url = normalizeInstallerDownloadUrl(meta.downloadUrl) || meta.downloadUrl;
      const fetched = await fetchInstallerFromUrl(
        url,
        meta.originalName || `Cierres-Comandas-${os}`,
      );
      return {
        kind: 'file',
        buffer: fetched.buffer,
        fileName: fetched.fileName,
        contentType: fetched.contentType,
      };
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
