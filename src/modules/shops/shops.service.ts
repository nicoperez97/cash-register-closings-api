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
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { AuthUser } from '../../common/decorators';
import { ClosingSourceKind, GlobalRole, LedgerAccountType } from '../../common/enums';
import { isGlobalAdmin, isSuperAdmin } from '../../common/guards';
import { normalizeLogoUrl } from '../../common/drive-url';
import { isEntityActive } from '../../common/active.util';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { normalizeOpeningTime } from '../../common/business-date';
import { shiftWindowFallback } from '../../common/employee-shift.util';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';
import { PosnetType, ShopPosnet } from '../../common/posnet';
import {
  earliestShiftOpening,
  normalizeShopShifts,
  type ShopShift,
} from '../../common/shop-shifts';
import { randomUUID } from 'crypto';
import { normalizeUserVisibility, UserVisibility } from '../../common/user-visibility';
import { normalizePartyRule } from '../reservations/reservation-party-rules.util';
import { shopTimeRequired } from '../reservations/reservation-public-form.util';
import { normalizeEmailMessageTemplates } from '../notifications/mail-message-templates.util';
import { normalizePaymentConceptCategories } from '../../common/concept-categories';
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
    @InjectRepository(ShopClosingSource)
    private readonly closingSources: Repository<ShopClosingSource>,
    private readonly catalogSeed: CatalogSeedService,
    private readonly live: ShopLiveService,
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
          ADD COLUMN reservationInsideMaxPartySize INT NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN reservationOutsideMinPartySize INT NULL
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
          ADD COLUMN emailMessageTemplates TEXT NULL
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
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN publicAttendanceEnabled TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN publicServiceRulesEnabled TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN serviceDefaultCheckIn VARCHAR(5) NOT NULL DEFAULT '18:00'
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN serviceDefaultCheckOut VARCHAR(5) NOT NULL DEFAULT '00:00'
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN serviceAttendanceWithHours TINYINT(1) NOT NULL DEFAULT 1
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN holidayPayMultiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          MODIFY COLUMN holidayPayMultiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00
      `);
    } catch {
      // ignore
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN dailySalaryConvertedAt DATETIME(6) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN menuEnabled TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN menu TEXT NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN paymentConceptCategories JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN navConfig JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN toolbarConfig JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN reservationPublicForm JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.shops.query(`
        ALTER TABLE shops
          ADD COLUMN shifts JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    await this.ensureDefaultShifts();
  }

  private async ensureDefaultShifts() {
    const rows = await this.shops.find();
    for (const shop of rows) {
      const next = normalizeShopShifts(shop.shifts, shop.openingTime);
      const opening = earliestShiftOpening(next);
      const same =
        JSON.stringify(shop.shifts ?? null) === JSON.stringify(next) &&
        shop.openingTime === opening;
      if (same) continue;
      shop.shifts = next;
      shop.openingTime = opening;
      await this.shops.save(shop);
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
    return this.withSettlementsEnabled(list.map((s) => this.toDto(s)));
  }

  async findAll(user: AuthUser) {
    if (!isSuperAdmin(user.globalRole as GlobalRole)) {
      return this.mine(user);
    }
    const list = await this.shops.find({ order: { name: 'ASC' } });
    return this.withSettlementsEnabled(list.map((s) => this.toDto(s)));
  }

  async findOne(user: AuthUser, id: string) {
    this.assertShopAccess(user, id);
    const shop = await this.shops.findOne({ where: { id } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const [dto] = await this.withSettlementsEnabled([
      this.toDto(shop, { emailSmtpConfigured: await this.hasSmtpPassword(id) }),
    ]);
    return dto;
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
        avatarUrl: u.avatarUrl ?? null,
        hasAvatar: !!u.avatarUrl,
        visibility,
        hideFromCashWithdraw: !visibility.cashWithdraw,
        ledgerAccounts: accountsByUser.get(u.id) ?? [],
      };
    });
  }

  /** Usuarios avisables del local (staff) + dueños globales. */
  async listNotificationRecipients(user: AuthUser, shopId: string) {
    this.assertShopAccess(user, shopId);
    return this.collectNotificationRecipients(shopId);
  }

  async resolveNotifyUserIds(
    shopId: string,
    actorId: string,
    opts?: { notifyAdmins?: boolean; notifyUserIds?: string[] | null },
  ): Promise<string[]> {
    const rows = await this.collectNotificationRecipients(shopId);
    const allowed = new Set(rows.map((r) => r.id));
    const ids = new Set<string>();
    if (opts?.notifyAdmins) {
      for (const r of rows) if (r.isAdmin) ids.add(r.id);
    }
    for (const id of opts?.notifyUserIds ?? []) {
      if (allowed.has(id)) ids.add(id);
    }
    ids.delete(actorId);
    return [...ids];
  }

  private async collectNotificationRecipients(shopId: string) {
    const links = await this.userShops.find({ where: { shopId } });
    const shopUserIds = links.map((l) => l.userId);
    const adminLinkIds = new Set(
      links
        .filter((l) => l.shopRole === GlobalRole.OWNER || l.shopRole === GlobalRole.ADMIN)
        .map((l) => l.userId),
    );
    const shopUsers = shopUserIds.length
      ? await this.users.find({
          where: { id: In(shopUserIds), active: true },
          order: { fullName: 'ASC' },
        })
      : [];
    const globalOwners = await this.users.find({
      where: { globalRole: GlobalRole.OWNER, active: true },
      order: { fullName: 'ASC' },
    });
    const byId = new Map<
      string,
      { id: string; fullName: string; email: string; isAdmin: boolean }
    >();
    const add = (
      u: { id: string; fullName: string; email: string; globalRole: GlobalRole },
      isAdmin: boolean,
    ) => {
      const prev = byId.get(u.id);
      byId.set(u.id, {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        isAdmin: (prev?.isAdmin ?? false) || isAdmin,
      });
    };
    for (const u of shopUsers) {
      add(u, adminLinkIds.has(u.id) || u.globalRole === GlobalRole.OWNER);
    }
    for (const u of globalOwners) add(u, true);
    return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  }

  async create(user: AuthUser, dto: CreateShopDto) {
    if (!isSuperAdmin(user.globalRole as GlobalRole)) {
      throw new ForbiddenException('Solo un super admin puede crear locales');
    }
    const slug = this.normalizeSlug(dto.slug || dto.name);
    await this.assertSlugFree(slug);
    const shifts = normalizeShopShifts(dto.shifts, dto.openingTime);
    const serviceFromShift = shiftWindowFallback(shifts, null);
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
        reservationInsideMaxPartySize: normalizePartyRule(dto.reservationInsideMaxPartySize),
        reservationOutsideMinPartySize: normalizePartyRule(
          dto.reservationOutsideMaxPartySize !== undefined
            ? dto.reservationOutsideMaxPartySize
            : dto.reservationOutsideMinPartySize,
        ),
        waitingListEnabled: dto.waitingListEnabled ?? true,
        tipsEnabled: dto.tipsEnabled ?? false,
        publicAttendanceEnabled: dto.publicAttendanceEnabled ?? false,
        publicServiceRulesEnabled: dto.publicServiceRulesEnabled ?? false,
        /** Legacy mirror of shift window (entrada/retirada ya no se configuran aparte). */
        serviceDefaultCheckIn: serviceFromShift.checkIn,
        serviceDefaultCheckOut: serviceFromShift.checkOut,
        serviceAttendanceWithHours: dto.serviceAttendanceWithHours ?? true,
        holidayPayMultiplier: String(
          dto.holidayPayMultiplier !== undefined && dto.holidayPayMultiplier !== null
            ? Math.max(0.01, Number(dto.holidayPayMultiplier) || 1)
            : 1,
        ),
        menuEnabled: dto.menuEnabled ?? false,
        defaultChangeAmount: String(dto.defaultChangeAmount ?? 0),
        productionDefaultHours: String(
          dto.productionDefaultHours !== undefined && dto.productionDefaultHours !== null
            ? Math.max(0, Number(dto.productionDefaultHours) || 0)
            : 8,
        ),
        timezone: dto.timezone ?? 'America/Argentina/Buenos_Aires',
        openingTime: earliestShiftOpening(shifts),
        shifts,
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
        emailMessageTemplates: normalizeEmailMessageTemplates(dto.emailMessageTemplates),
        salesSystemId: dto.salesSystemId ?? null,
        posPaymentMap: dto.posPaymentMap ?? null,
        posnets: this.normalizePosnets(dto.posnets),
        paymentConceptCategories: dto.paymentConceptCategories
          ? normalizePaymentConceptCategories(dto.paymentConceptCategories)
          : null,
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
    if (dto.reservationInsideMaxPartySize !== undefined) {
      shop.reservationInsideMaxPartySize = normalizePartyRule(
        dto.reservationInsideMaxPartySize,
      );
    }
    const outsideMax =
      dto.reservationOutsideMaxPartySize !== undefined
        ? dto.reservationOutsideMaxPartySize
        : dto.reservationOutsideMinPartySize;
    if (outsideMax !== undefined) {
      shop.reservationOutsideMinPartySize = normalizePartyRule(outsideMax);
    }
    // Si el módulo de reservas está apagado, ambos sectores pueden quedar off.
    if (
      shop.reservationsEnabled !== false &&
      shop.reservationInsideEnabled === false &&
      shop.reservationOutsideEnabled === false
    ) {
      throw new BadRequestException('Dejá al menos un sector habilitado (adentro o afuera)');
    }
    if (dto.waitingListEnabled !== undefined) {
      shop.waitingListEnabled = dto.waitingListEnabled;
    }
    if (dto.tipsEnabled !== undefined) {
      shop.tipsEnabled = dto.tipsEnabled;
    }
    if (dto.publicAttendanceEnabled !== undefined) {
      shop.publicAttendanceEnabled = dto.publicAttendanceEnabled;
    }
    if (dto.publicServiceRulesEnabled !== undefined) {
      shop.publicServiceRulesEnabled = dto.publicServiceRulesEnabled;
    }
    if (dto.serviceAttendanceWithHours !== undefined) {
      shop.serviceAttendanceWithHours = dto.serviceAttendanceWithHours;
    }
    if (dto.holidayPayMultiplier !== undefined) {
      if (Number(dto.holidayPayMultiplier) <= 0) {
        throw new BadRequestException('El multiplicador de feriado debe ser mayor a 0');
      }
      shop.holidayPayMultiplier = Number(dto.holidayPayMultiplier).toFixed(2);
    }
    if (dto.menuEnabled !== undefined) {
      shop.menuEnabled = dto.menuEnabled;
    }
    if (dto.timezone !== undefined) shop.timezone = dto.timezone;
    if (dto.shifts !== undefined) {
      shop.shifts = this.normalizeShifts(dto.shifts, dto.openingTime ?? shop.openingTime);
      shop.openingTime = earliestShiftOpening(shop.shifts);
      this.syncLegacyServiceDefaultsFromShifts(shop);
    } else if (dto.openingTime !== undefined) {
      shop.openingTime = normalizeOpeningTime(dto.openingTime);
      shop.shifts = this.syncOpeningOnShifts(shop.shifts, shop.openingTime);
      this.syncLegacyServiceDefaultsFromShifts(shop);
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
    if (dto.emailMessageTemplates !== undefined) {
      shop.emailMessageTemplates = normalizeEmailMessageTemplates(dto.emailMessageTemplates);
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
    if (dto.paymentConceptCategories !== undefined) {
      shop.paymentConceptCategories = dto.paymentConceptCategories
        ? normalizePaymentConceptCategories(dto.paymentConceptCategories)
        : null;
    }
    if (dto.navConfig !== undefined) {
      shop.navConfig = dto.navConfig ? this.normalizeNavConfig(dto.navConfig) : null;
    }
    if (dto.toolbarConfig !== undefined) {
      shop.toolbarConfig = dto.toolbarConfig
        ? this.normalizeToolbarConfig(dto.toolbarConfig)
        : null;
    }

    await this.shops.save(shop);
    if (smtpPasswordPatch !== undefined) {
      // Solo actualizar si vino null (borrar) o string no vacío
      if (smtpPasswordPatch === null || smtpPasswordPatch) {
        await this.shops.update(id, { emailSmtpPassword: smtpPasswordPatch });
      }
    }
    if (
      dto.reservationsEnabled !== undefined ||
      dto.reservationSignupEnabled !== undefined ||
      dto.reservationInsideEnabled !== undefined ||
      dto.reservationOutsideEnabled !== undefined ||
      dto.reservationInsideMaxPartySize !== undefined ||
      dto.reservationOutsideMaxPartySize !== undefined ||
      dto.reservationOutsideMinPartySize !== undefined ||
      dto.closedWeekdays !== undefined ||
      dto.openingTime !== undefined
    ) {
      this.live.tick(id, 'reservations');
    }
    if (dto.waitingListEnabled !== undefined) this.live.tick(id, 'waiting');
    if (
      dto.publicAttendanceEnabled !== undefined ||
      dto.serviceAttendanceWithHours !== undefined ||
      dto.shifts !== undefined ||
      dto.openingTime !== undefined
    ) {
      this.live.tick(id, 'attendance');
    }
    return this.toDto(await this.shops.findOneOrFail({ where: { id } }), {
      emailSmtpConfigured: await this.hasSmtpPassword(id),
    });
  }

  /** Mirror legacy columns from the primary shift window (no longer user-editable). */
  private syncLegacyServiceDefaultsFromShifts(shop: Shop): void {
    const shifts = normalizeShopShifts(shop.shifts, shop.openingTime);
    const fb = shiftWindowFallback(shifts, null);
    shop.serviceDefaultCheckIn = fb.checkIn;
    shop.serviceDefaultCheckOut = fb.checkOut;
  }

  private normalizeShifts(
    raw?: Array<{ id?: string; name?: string; opensAt?: string; closesAt?: string }> | null,
    fallbackOpening?: string | null,
  ): ShopShift[] {
    if (raw != null && !Array.isArray(raw)) {
      throw new BadRequestException('shifts inválido');
    }
    if (Array.isArray(raw) && !raw.length) {
      throw new BadRequestException('El local necesita al menos un turno');
    }
    for (const row of raw ?? []) {
      const name = String(row?.name ?? '').trim();
      if (!name) throw new BadRequestException('Cada turno necesita un nombre');
    }
    return normalizeShopShifts(raw, fallbackOpening);
  }

  private syncOpeningOnShifts(
    raw?: ShopShift[] | null,
    openingTime?: string | null,
  ): ShopShift[] {
    const shifts = normalizeShopShifts(raw, openingTime);
    if (shifts.length !== 1) return shifts;
    const open = normalizeOpeningTime(openingTime);
    const only = shifts[0];
    const was24h = only.opensAt === only.closesAt;
    only.opensAt = open;
    if (was24h) only.closesAt = open;
    return shifts;
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
      shifts: normalizeShopShifts(s.shifts, s.openingTime),
      closedWeekdays: Array.isArray(s.closedWeekdays) ? s.closedWeekdays : [],
      currency: s.currency,
      unitsLabel: s.unitsLabel,
      coversEnabled: !!s.coversEnabled,
      reservationsEnabled: !!s.reservationsEnabled,
      reservationSignupEnabled:
        s.reservationSignupEnabled === undefined || s.reservationSignupEnabled === null
          ? true
          : !!s.reservationSignupEnabled,
      reservationTimeRequired: shopTimeRequired(s),
      reservationInsideEnabled:
        s.reservationInsideEnabled === undefined || s.reservationInsideEnabled === null
          ? true
          : !!s.reservationInsideEnabled,
      reservationOutsideEnabled:
        s.reservationOutsideEnabled === undefined || s.reservationOutsideEnabled === null
          ? true
          : !!s.reservationOutsideEnabled,
      reservationInsideMaxPartySize:
        s.reservationInsideMaxPartySize == null
          ? null
          : Number(s.reservationInsideMaxPartySize) || null,
      reservationOutsideMaxPartySize:
        s.reservationOutsideMinPartySize == null
          ? null
          : Number(s.reservationOutsideMinPartySize) || null,
      reservationOutsideMinPartySize:
        s.reservationOutsideMinPartySize == null
          ? null
          : Number(s.reservationOutsideMinPartySize) || null,
      waitingListEnabled: !!s.waitingListEnabled,
      tipsEnabled: !!s.tipsEnabled,
      settlementsEnabled: false,
      publicAttendanceEnabled: !!s.publicAttendanceEnabled,
      publicServiceRulesEnabled: !!s.publicServiceRulesEnabled,
      serviceDefaultCheckIn: s.serviceDefaultCheckIn || '18:00',
      serviceDefaultCheckOut: s.serviceDefaultCheckOut || '00:00',
      serviceAttendanceWithHours:
        s.serviceAttendanceWithHours === undefined || s.serviceAttendanceWithHours === null
          ? true
          : !!s.serviceAttendanceWithHours,
      holidayPayMultiplier: Number(s.holidayPayMultiplier ?? 1) || 1,
      menuEnabled: !!s.menuEnabled,
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
      emailMessageTemplates:
        s.emailMessageTemplates && typeof s.emailMessageTemplates === 'object'
          ? s.emailMessageTemplates
          : null,
      salesSystemId: s.salesSystemId ?? null,
      posPaymentMap: s.posPaymentMap ?? null,
      posnets: s.posnets ?? [],
      paymentConceptCategories: normalizePaymentConceptCategories(s.paymentConceptCategories),
      navConfig: s.navConfig && typeof s.navConfig === 'object' ? s.navConfig : null,
      toolbarConfig:
        s.toolbarConfig && typeof s.toolbarConfig === 'object' ? s.toolbarConfig : null,
      active: isEntityActive(s.active),
    };
  }

  private normalizeNavConfig(
    raw: {
      groups?: Array<{ id: string; label?: string }>;
      itemGroup?: Record<string, string>;
      itemOrder?: Record<string, string[]>;
      hidden?: string[];
      itemLabels?: Record<string, string>;
    },
  ): Shop['navConfig'] {
    const groups = Array.isArray(raw.groups)
      ? raw.groups
          .filter((g) => g && typeof g.id === 'string' && g.id.trim())
          .map((g) => ({
            id: String(g.id).trim(),
            ...(typeof g.label === 'string' && g.label.trim()
              ? { label: g.label.trim() }
              : {}),
          }))
      : undefined;
    const itemGroup =
      raw.itemGroup && typeof raw.itemGroup === 'object'
        ? Object.fromEntries(
            Object.entries(raw.itemGroup)
              .filter(([k, v]) => k && typeof v === 'string' && v.trim())
              .map(([k, v]) => [k, String(v).trim()]),
          )
        : undefined;
    const itemOrder =
      raw.itemOrder && typeof raw.itemOrder === 'object'
        ? Object.fromEntries(
            Object.entries(raw.itemOrder)
              .filter(([, v]) => Array.isArray(v))
              .map(([k, v]) => [k, (v as string[]).map(String).filter(Boolean)]),
          )
        : undefined;
    const hidden = Array.isArray(raw.hidden)
      ? raw.hidden.map(String).filter(Boolean)
      : undefined;
    const itemLabels =
      raw.itemLabels && typeof raw.itemLabels === 'object'
        ? Object.fromEntries(
            Object.entries(raw.itemLabels)
              .filter(([k, v]) => k && typeof v === 'string' && v.trim())
              .map(([k, v]) => [k, String(v).trim()]),
          )
        : undefined;
    return { groups, itemGroup, itemOrder, hidden, itemLabels };
  }

  private normalizeToolbarConfig(raw: {
    order?: string[];
    hidden?: string[];
    custom?: Array<{ id?: string; label?: string; icon?: string; route?: string }>;
  }): Shop['toolbarConfig'] {
    const order = Array.isArray(raw.order)
      ? raw.order.map(String).filter(Boolean)
      : undefined;
    const hidden = Array.isArray(raw.hidden)
      ? raw.hidden.map(String).filter(Boolean)
      : undefined;
    const custom = Array.isArray(raw.custom)
      ? raw.custom
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            id: String(c.id ?? '').trim(),
            label: String(c.label ?? '').trim(),
            icon: String(c.icon ?? '').trim() || 'bolt',
            route: String(c.route ?? '').trim(),
          }))
          .filter((c) => c.id && c.label && c.route.startsWith('/'))
      : undefined;
    return { order, hidden, custom: custom?.length ? custom : undefined };
  }

  private async withSettlementsEnabled<T extends { id: string; settlementsEnabled?: boolean }>(
    dtos: T[],
  ): Promise<T[]> {
    if (!dtos.length) return dtos;
    const rows = await this.closingSources.find({
      where: {
        shopId: In(dtos.map((d) => d.id)),
        active: true,
        kind: In([ClosingSourceKind.SETTLE_CASH, ClosingSourceKind.SETTLE_ACCOUNT]),
      },
      select: ['shopId'],
    });
    const enabled = new Set(rows.map((r) => r.shopId));
    return dtos.map((d) => ({ ...d, settlementsEnabled: enabled.has(d.id) }));
  }
}
