import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole, LedgerAccountType } from '../../common/enums';
import { isGlobalAdmin, isSuperAdmin } from '../../common/guards';
import { normalizeLogoUrl } from '../../common/drive-url';
import { isEntityActive } from '../../common/active.util';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { normalizeOpeningTime } from '../../common/business-date';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';
import { PosnetType, ShopPosnet } from '../../common/posnet';
import { randomUUID } from 'crypto';
import { normalizeUserVisibility, UserVisibility } from '../../common/user-visibility';
import {
  deleteUploadIfExists,
  resolveUploadPath,
  saveUploadFile,
} from '../../common/uploads';
import { readFileSync } from 'fs';
import { extname } from 'path';

const SHOP_ADMIN_ROLES = new Set([
  GlobalRole.OWNER,
  GlobalRole.ADMIN,
  GlobalRole.MANAGER,
]);

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const POSNET_TYPES = new Set(Object.values(PosnetType));
const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

function isUploadedLogoPath(raw?: string | null): boolean {
  const v = (raw ?? '').trim().replace(/\\/g, '/');
  return !!v && !/^https?:\/\//i.test(v) && v.startsWith('shops/');
}

function mimeFromLogoPath(relativePath: string): string {
  const ext = extname(relativePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
}

@Injectable()
export class ShopsService implements OnModuleInit {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(LedgerAccount) private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(LedgerAccountUser)
    private readonly accountLinks: Repository<LedgerAccountUser>,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async onModuleInit() {
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN openingTime VARCHAR(5) NOT NULL DEFAULT '10:00'
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN reservationsEnabled TINYINT(1) NOT NULL DEFAULT 1
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN waitingListEnabled TINYINT(1) NOT NULL DEFAULT 1
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN reservationSignupEnabled TINYINT(1) NOT NULL DEFAULT 1
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN reservationInsideEnabled TINYINT(1) NOT NULL DEFAULT 1
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN reservationOutsideEnabled TINYINT(1) NOT NULL DEFAULT 1
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN productionDefaultHours DECIMAL(6,2) NOT NULL DEFAULT 8.00
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN accentSecondary VARCHAR(16) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN email VARCHAR(180) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN instagramHandle VARCHAR(30) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN phone VARCHAR(40) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN emailNotificationsEnabled TINYINT(1) NOT NULL DEFAULT 1
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN emailNotificationTypes TEXT NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN emailNotificationUserIds TEXT NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN emailSmtpPassword VARCHAR(255) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN tipsEnabled TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
  }

  assertShopAccess(user: AuthUser, shopId: string) {
    if (isSuperAdmin(user.globalRole as GlobalRole)) return;
    if (!user.shopIds.includes(shopId)) {
      throw new ForbiddenException('Sin acceso a este local');
    }
  }

  async assertReservationsEnabled(shopId: string) {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.reservationsEnabled) {
      throw new ForbiddenException('Reservas deshabilitadas en este local');
    }
    return shop;
  }

  async assertWaitingListEnabled(shopId: string) {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.waitingListEnabled) {
      throw new ForbiddenException('Lista de espera deshabilitada en este local');
    }
    return shop;
  }

  async assertTipsEnabled(shopId: string) {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.tipsEnabled) {
      throw new ForbiddenException('Propinas deshabilitadas en este local');
    }
    return shop;
  }

  async getShopEntity(shopId: string) {
    return this.shops.findOne({ where: { id: shopId } });
  }

  async findActiveBySlug(slug: string) {
    return this.shops.findOne({ where: { slug, active: true } });
  }

  /** Admin del local (shopRole) o admin/owner global, o manager con shops.manage. */
  assertShopManage(user: AuthUser, shopId: string) {
    this.assertShopAccess(user, shopId);
    if (isGlobalAdmin(user.globalRole as GlobalRole)) return;
    const role = (user.shopRoles?.[shopId] ?? user.globalRole) as GlobalRole;
    if (SHOP_ADMIN_ROLES.has(role) && user.permissions.includes('shops.manage')) {
      return;
    }
    throw new ForbiddenException('No podés administrar este local');
  }

  async mine(user: AuthUser) {
    if (!user.shopIds.length) return [];
    const list = await this.shops.find({
      where: { id: In(user.shopIds), active: true },
      order: { name: 'ASC' },
    });
    return list.map((s) => this.toDto(s));
  }

  async findAll(user: AuthUser) {
    if (!isSuperAdmin(user.globalRole as GlobalRole)) {
      return this.mine(user);
    }
    const list = await this.shops.find({ order: { name: 'ASC' } });
    return list.map((s) => this.toDto(s));
  }

  async findOne(user: AuthUser, id: string) {
    this.assertShopAccess(user, id);
    const shop = await this.shops.findOne({ where: { id } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return this.toDto(shop, { emailSmtpConfigured: await this.hasSmtpPassword(id) });
  }

  /** Usuarios del local (para “quién se lo lleva”, etc.). Incluye cuentas PARTNER asociadas. */
  async listUsers(user: AuthUser, shopId: string) {
    this.assertShopAccess(user, shopId);
    const links = await this.userShops.find({ where: { shopId } });
    const ids = links.map((l) => l.userId);
    if (!ids.length) return [];
    const rows = await this.users.find({
      where: { id: In(ids), active: true },
      order: { fullName: 'ASC' },
    });
    const accountLinks = await this.accountLinks.find({
      where: { shopId, userId: In(ids) },
    });
    const accountIds = [...new Set(accountLinks.map((l) => l.accountId))];
    const accounts = accountIds.length
      ? await this.accounts.find({
          where: { shopId, id: In(accountIds), active: true },
          order: { name: 'ASC' },
        })
      : [];
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const accountsByUser = new Map<string, Array<{ id: string; name: string; code: string }>>();
    for (const link of accountLinks) {
      const acc = accountById.get(link.accountId);
      if (!acc) continue;
      if (acc.type !== LedgerAccountType.PARTNER) continue;
      if (acc.hideFromCashWithdraw) continue;
      const list = accountsByUser.get(link.userId) ?? [];
      list.push({ id: acc.id, name: acc.name, code: acc.code });
      accountsByUser.set(link.userId, list);
    }
    const visibilityByUser = new Map<string, ReturnType<typeof normalizeUserVisibility>>();
    for (const l of links) {
      visibilityByUser.set(
        l.userId,
        normalizeUserVisibility(l.visibility as Partial<UserVisibility> | null, {
          hideFromCashWithdraw: !!l.hideFromCashWithdraw,
        }),
      );
    }
    return rows.map((u) => {
      const visibility = visibilityByUser.get(u.id) ?? normalizeUserVisibility(null);
      return {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        visibility,
        hideFromCashWithdraw: !visibility.cashWithdraw,
        ledgerAccounts: accountsByUser.get(u.id) ?? [],
      };
    });
  }

  async create(user: AuthUser, dto: CreateShopDto) {
    if (!isSuperAdmin(user.globalRole as GlobalRole)) {
      throw new ForbiddenException('Solo un super admin puede crear locales');
    }
    const slug = this.normalizeSlug(dto.slug || dto.name);
    await this.assertSlugFree(slug);
    const shop = await this.shops.save(
      this.shops.create({
        name: dto.name.trim(),
        slug,
        unitsLabel: dto.unitsLabel ?? null,
        coversEnabled: dto.coversEnabled ?? false,
        reservationsEnabled: dto.reservationsEnabled ?? true,
        reservationSignupEnabled: dto.reservationSignupEnabled ?? true,
        reservationInsideEnabled: dto.reservationInsideEnabled ?? true,
        reservationOutsideEnabled: dto.reservationOutsideEnabled ?? true,
        waitingListEnabled: dto.waitingListEnabled ?? true,
        tipsEnabled: dto.tipsEnabled ?? false,
        defaultChangeAmount: String(dto.defaultChangeAmount ?? 0),
        productionDefaultHours: String(
          dto.productionDefaultHours !== undefined && dto.productionDefaultHours !== null
            ? Math.max(0, Number(dto.productionDefaultHours) || 0)
            : 8,
        ),
        timezone: dto.timezone ?? 'America/Argentina/Buenos_Aires',
        openingTime: normalizeOpeningTime(dto.openingTime),
        closedWeekdays: this.normalizeClosedWeekdays(dto.closedWeekdays),
        currency: dto.currency ?? 'ARS',
        logoUrl: normalizeLogoUrl(dto.logoUrl),
        accentColor: this.normalizeAccent(dto.accentColor),
        accentSecondary: this.normalizeAccent(dto.accentSecondary),
        email: this.normalizeEmail(dto.email),
        instagramHandle: this.normalizeInstagram(dto.instagramHandle),
        phone: this.normalizePhone(dto.phone),
        emailSmtpPassword: this.normalizeSmtpPassword(dto.emailSmtpPassword) ?? null,
        emailNotificationsEnabled: dto.emailNotificationsEnabled ?? true,
        emailNotificationTypes: this.normalizeStringList(dto.emailNotificationTypes),
        emailNotificationUserIds: this.normalizeStringList(dto.emailNotificationUserIds),
        salesSystemId: dto.salesSystemId ?? null,
        posPaymentMap: dto.posPaymentMap ?? null,
        posnets: this.normalizePosnets(dto.posnets),
        active: true,
      }),
    );
    await this.catalogSeed.seedNewShopCatalogs(shop.id);
    return this.toDto(shop, {
      emailSmtpConfigured: await this.hasSmtpPassword(shop.id),
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateShopDto) {
    this.assertShopManage(user, id);
    const shop = await this.shops.findOne({ where: { id } });
    if (!shop) throw new NotFoundException('Local no encontrado');

    if (dto.name !== undefined) shop.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const slug = this.normalizeSlug(dto.slug);
      await this.assertSlugFree(slug, id);
      shop.slug = slug;
    }
    if (dto.unitsLabel !== undefined) shop.unitsLabel = dto.unitsLabel || null;
    if (dto.coversEnabled !== undefined) shop.coversEnabled = dto.coversEnabled;
    if (dto.reservationsEnabled !== undefined) {
      shop.reservationsEnabled = dto.reservationsEnabled;
    }
    if (dto.reservationSignupEnabled !== undefined) {
      shop.reservationSignupEnabled = dto.reservationSignupEnabled;
    }
    if (dto.reservationInsideEnabled !== undefined) {
      shop.reservationInsideEnabled = dto.reservationInsideEnabled;
    }
    if (dto.reservationOutsideEnabled !== undefined) {
      shop.reservationOutsideEnabled = dto.reservationOutsideEnabled;
    }
    if (shop.reservationInsideEnabled === false && shop.reservationOutsideEnabled === false) {
      throw new BadRequestException('Dejá al menos un sector habilitado (adentro o afuera)');
    }
    if (dto.waitingListEnabled !== undefined) {
      shop.waitingListEnabled = dto.waitingListEnabled;
    }
    if (dto.tipsEnabled !== undefined) {
      shop.tipsEnabled = dto.tipsEnabled;
    }
    if (dto.timezone !== undefined) shop.timezone = dto.timezone;
    if (dto.openingTime !== undefined) {
      shop.openingTime = normalizeOpeningTime(dto.openingTime);
    }
    if (dto.closedWeekdays !== undefined) {
      shop.closedWeekdays = this.normalizeClosedWeekdays(dto.closedWeekdays);
    }
    if (dto.currency !== undefined) shop.currency = dto.currency;
    if (dto.active !== undefined) shop.active = isEntityActive(dto.active);
    if (dto.defaultChangeAmount !== undefined) {
      shop.defaultChangeAmount = String(dto.defaultChangeAmount);
    }
    if (dto.productionDefaultHours !== undefined) {
      shop.productionDefaultHours = String(
        Math.max(0, Number(dto.productionDefaultHours) || 0),
      );
    }
    if (dto.logoUrl !== undefined) {
      const next = normalizeLogoUrl(dto.logoUrl);
      if (isUploadedLogoPath(shop.logoUrl) && shop.logoUrl !== next) {
        deleteUploadIfExists(shop.logoUrl);
      }
      shop.logoUrl = next;
    }
    if (dto.accentColor !== undefined) {
      shop.accentColor = this.normalizeAccent(dto.accentColor);
    }
    if (dto.accentSecondary !== undefined) {
      shop.accentSecondary = this.normalizeAccent(dto.accentSecondary);
    }
    if (dto.email !== undefined) {
      shop.email = this.normalizeEmail(dto.email);
    }
    if (dto.instagramHandle !== undefined) {
      shop.instagramHandle = this.normalizeInstagram(dto.instagramHandle);
    }
    if (dto.phone !== undefined) {
      shop.phone = this.normalizePhone(dto.phone);
    }
    // Contraseña con select:false: no asignar al entity cargado (TypeORM la pisaría en save).
    const smtpPasswordPatch =
      dto.emailSmtpPassword === undefined
        ? undefined
        : dto.emailSmtpPassword === null
          ? null
          : this.normalizeSmtpPassword(dto.emailSmtpPassword);
    if (dto.emailNotificationsEnabled !== undefined) {
      shop.emailNotificationsEnabled = !!dto.emailNotificationsEnabled;
    }
    if (dto.emailNotificationTypes !== undefined) {
      shop.emailNotificationTypes = this.normalizeStringList(dto.emailNotificationTypes);
    }
    if (dto.emailNotificationUserIds !== undefined) {
      shop.emailNotificationUserIds = this.normalizeStringList(dto.emailNotificationUserIds);
    }
    if (dto.salesSystemId !== undefined) {
      shop.salesSystemId = dto.salesSystemId || null;
    }
    if (dto.posPaymentMap !== undefined) {
      shop.posPaymentMap = dto.posPaymentMap;
    }
    if (dto.posnets !== undefined) {
      shop.posnets = this.normalizePosnets(dto.posnets);
    }

    await this.shops.save(shop);
    if (smtpPasswordPatch !== undefined) {
      // Solo actualizar si vino null (borrar) o string no vacío
      if (smtpPasswordPatch === null || smtpPasswordPatch) {
        await this.shops.update(id, { emailSmtpPassword: smtpPasswordPatch });
      }
    }
    return this.toDto(await this.shops.findOneOrFail({ where: { id } }), {
      emailSmtpConfigured: await this.hasSmtpPassword(id),
    });
  }

  private normalizePosnets(
    raw?: Array<{ id?: string; name: string; type: PosnetType | string }> | null,
  ): ShopPosnet[] | null {
    if (raw == null) return null;
    if (!Array.isArray(raw)) {
      throw new BadRequestException('posnets inválido');
    }
    const out: ShopPosnet[] = [];
    for (const row of raw) {
      const name = String(row?.name ?? '').trim();
      const type = String(row?.type ?? '').trim() as PosnetType;
      if (!name) throw new BadRequestException('Cada posnet necesita un nombre');
      if (!POSNET_TYPES.has(type)) {
        throw new BadRequestException(`Tipo de posnet inválido: ${row?.type}`);
      }
      out.push({
        id: String(row?.id ?? '').trim() || randomUUID(),
        name,
        type,
      });
    }
    return out;
  }

  private normalizeClosedWeekdays(raw?: number[] | null): number[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException('closedWeekdays inválido');
    }
    const set = new Set<number>();
    for (const v of raw) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 6) {
        throw new BadRequestException('Cada día de franco debe ser 0–6');
      }
      set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }

  private normalizeSlug(raw: string): string {
    const s = raw
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (s.length < 2) {
      throw new BadRequestException('Slug inválido (mínimo 2 caracteres)');
    }
    return s;
  }

  private async assertSlugFree(slug: string, exceptId?: string) {
    const clash = await this.shops.findOne({
      where: exceptId ? { slug, id: Not(exceptId) } : { slug },
    });
    if (clash) throw new BadRequestException('Ya existe un local con ese slug');
  }

  private normalizeAccent(raw?: string | null): string | null {
    const v = raw?.trim();
    if (!v) return null;
    if (!HEX_COLOR.test(v)) return null;
    return v.length === 4
      ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase()
      : v.toUpperCase();
  }

  private normalizeEmail(raw?: string | null): string | null {
    const v = raw?.trim().toLowerCase();
    if (!v) return null;
    return v;
  }

  private normalizePhone(raw?: string | null): string | null {
    const phone = String(raw ?? '').trim();
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) {
      throw new BadRequestException('Teléfono inválido (incluí código de país, p.ej. +598…)');
    }
    return phone;
  }

  private normalizeInstagram(raw?: string | null): string | null {
    let s = String(raw ?? '').trim();
    if (!s) return null;
    s = s.replace(/^@+/, '');
    s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
    s = s.replace(/[/?#].*$/, '').replace(/^@+/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) {
      throw new BadRequestException('Instagram inválido (solo usuario, sin espacios)');
    }
    return s;
  }

  private normalizeSmtpPassword(raw?: string | null): string | null {
    const v = String(raw ?? '').trim();
    return v || null;
  }

  private async hasSmtpPassword(shopId: string): Promise<boolean> {
    const row = await this.shops
      .createQueryBuilder('s')
      .select('s.emailSmtpPassword', 'pwd')
      .where('s.id = :id', { id: shopId })
      .getRawOne<{ pwd?: string | null }>();
    return !!String(row?.pwd ?? '').trim();
  }

  /** null = “todos”; [] = ninguno. */
  private normalizeStringList(raw?: string[] | null): string[] | null {
    if (raw == null) return null;
    if (!Array.isArray(raw)) return null;
    return [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))];
  }

  /**
   * Guarda logo subido en uploads/shops/:id y actualiza logoUrl (path relativo).
   */
  async uploadLogo(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.assertShopManage(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!file?.buffer?.length && !(file as Express.Multer.File & { path?: string })?.path) {
      throw new BadRequestException('Archivo requerido');
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (mime && !IMAGE_MIME.has(mime) && !mime.startsWith('image/')) {
      throw new BadRequestException('El logo debe ser una imagen (PNG, JPG, WEBP…)');
    }
    if (isUploadedLogoPath(shop.logoUrl)) {
      deleteUploadIfExists(shop.logoUrl);
    }
    let buffer = file.buffer;
    if (!buffer?.length && (file as Express.Multer.File & { path?: string }).path) {
      buffer = readFileSync((file as Express.Multer.File & { path: string }).path);
    }
    if (!buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }
    const saved = saveUploadFile({
      relativeDir: `shops/${shopId}`,
      basename: 'logo',
      buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });
    shop.logoUrl = saved.relativePath;
    await this.shops.save(shop);
    return this.toDto(shop, {
      emailSmtpConfigured: await this.hasSmtpPassword(shop.id),
    });
  }

  /**
   * Descarga el logo del local (archivo subido o URL externa) para same-origin
   * en notificaciones push / SW / <img>.
   */
  async fetchPublicLogo(
    shopId: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const shop = await this.shops.findOne({
      where: { id: shopId, active: true },
      select: ['id', 'logoUrl'],
    });
    const raw = shop?.logoUrl?.trim() ?? null;
    if (!raw) return null;

    if (isUploadedLogoPath(raw)) {
      const abs = resolveUploadPath(raw);
      if (!abs) return null;
      try {
        const buffer = readFileSync(abs);
        if (!buffer.length) return null;
        return { buffer, contentType: mimeFromLogoPath(raw) };
      } catch {
        return null;
      }
    }

    const url = normalizeLogoUrl(raw) ?? raw;
    if (!/^https?:\/\//i.test(url)) return null;

    try {
      const upstream = await fetch(url, {
        redirect: 'follow',
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });
      if (!upstream.ok) return null;
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.toLowerCase().startsWith('image/')) return null;
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (!buffer.length) return null;
      return { buffer, contentType };
    } catch {
      return null;
    }
  }

  toDto(s: Shop, opts?: { emailSmtpConfigured?: boolean }) {
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      timezone: s.timezone,
      openingTime: normalizeOpeningTime(s.openingTime),
      closedWeekdays: Array.isArray(s.closedWeekdays) ? s.closedWeekdays : [],
      currency: s.currency,
      unitsLabel: s.unitsLabel,
      coversEnabled: !!s.coversEnabled,
      reservationsEnabled: !!s.reservationsEnabled,
      reservationSignupEnabled:
        s.reservationSignupEnabled === undefined || s.reservationSignupEnabled === null
          ? true
          : !!s.reservationSignupEnabled,
      reservationInsideEnabled:
        s.reservationInsideEnabled === undefined || s.reservationInsideEnabled === null
          ? true
          : !!s.reservationInsideEnabled,
      reservationOutsideEnabled:
        s.reservationOutsideEnabled === undefined || s.reservationOutsideEnabled === null
          ? true
          : !!s.reservationOutsideEnabled,
      waitingListEnabled: !!s.waitingListEnabled,
      tipsEnabled: !!s.tipsEnabled,
      defaultChangeAmount: Number(s.defaultChangeAmount),
      productionDefaultHours: Number(s.productionDefaultHours ?? 8) || 8,
      logoUrl: s.logoUrl ?? null,
      accentColor: s.accentColor ?? null,
      accentSecondary: s.accentSecondary ?? null,
      email: s.email ?? null,
      instagramHandle: s.instagramHandle ?? null,
      phone: s.phone ?? null,
      emailSmtpConfigured: !!opts?.emailSmtpConfigured,
      emailNotificationsEnabled:
        s.emailNotificationsEnabled === undefined || s.emailNotificationsEnabled === null
          ? true
          : !!s.emailNotificationsEnabled,
      emailNotificationTypes: Array.isArray(s.emailNotificationTypes)
        ? s.emailNotificationTypes
        : null,
      emailNotificationUserIds: Array.isArray(s.emailNotificationUserIds)
        ? s.emailNotificationUserIds
        : null,
      salesSystemId: s.salesSystemId ?? null,
      posPaymentMap: s.posPaymentMap ?? null,
      posnets: s.posnets ?? [],
      active: isEntityActive(s.active),
    };
  }
}
