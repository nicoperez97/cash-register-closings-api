import { Injectable, UnauthorizedException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../../entities/user.entity';
import { Shop } from '../../entities/shop.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import {
  ClosingSourceKind,
  ClosingStatus,
  ExpenseCategory,
  ExtraLineType,
  GlobalRole,
} from '../../common/enums';
import { isGlobalAdmin, isSuperAdmin } from '../../common/guards';
import { AuthUser } from '../../common/decorators';
import {
  ALL_PERMISSIONS_LIST,
  deriveModulesFromRole,
  expandModulePermissions,
  ModulePermissionsMap,
} from '../../common/module-permissions';
import { Permission } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { closingDateKey } from '../../common/soft-delete.util';
import { saveUploadFile } from '../../common/uploads';

const IDS = {
  panino: '11111111-1111-1111-1111-111111111111',
  tutto: '22222222-2222-2222-2222-222222222222',
  admin: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  manager: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  cashier: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(ClosingExpense) private readonly expenses: Repository<ClosingExpense>,
    @InjectRepository(ClosingExtraLine) private readonly extras: Repository<ClosingExtraLine>,
    @InjectRepository(LedgerAccountUser)
    private readonly accountLinks: Repository<LedgerAccountUser>,
    @InjectRepository(ShopClosingSource)
    private readonly closingSources: Repository<ShopClosingSource>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.users.query(`
        ALTER TABLE users
          ADD COLUMN favoriteShopId CHAR(36) NULL
      `);
    } catch {
      // ya existe
    }
    // Seed demo solo si se pide explícitamente (nunca por defecto en prod/local limpio).
    if (process.env.ENABLE_DEMO_SEED !== 'true') {
      return;
    }
    try {
      await this.ensureSeed();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AuthService] Seed failed:', err);
    }
  }

  private async ensureSeed() {
    let panino = await this.shops.findOne({ where: { id: IDS.panino } });
    if (!panino) {
      panino = await this.shops.save(
        this.shops.create({
          id: IDS.panino,
          name: 'Al Panino',
          slug: 'al-panino',
          unitsLabel: 'paninos',
          coversEnabled: false,
          defaultChangeAmount: '15000.00',
          accentColor: '#E65100',
          accentSecondary: '#FFB300',
          active: true,
        }),
      );
    } else if (!panino.accentColor) {
      panino.accentColor = '#E65100';
      await this.shops.save(panino);
    }
    if (panino && !panino.accentSecondary) {
      panino.accentSecondary = '#FFB300';
      await this.shops.save(panino);
    }

    let tutto = await this.shops.findOne({ where: { id: IDS.tutto } });
    if (!tutto) {
      tutto = await this.shops.save(
        this.shops.create({
          id: IDS.tutto,
          name: 'Tutto Passa',
          slug: 'tutto-passa',
          unitsLabel: null,
          coversEnabled: true,
          defaultChangeAmount: '0.00',
          accentColor: '#00897B',
          accentSecondary: '#26A69A',
          active: true,
        }),
      );
    } else if (!tutto.accentColor) {
      tutto.accentColor = '#00897B';
      await this.shops.save(tutto);
    }
    if (tutto && !tutto.accentSecondary) {
      tutto.accentSecondary = '#26A69A';
      await this.shops.save(tutto);
    }

    const passwordHash = await bcrypt.hash('demo', 10);
    const seedUsers: Array<Partial<User> & { shopIds: string[] }> = [
      {
        id: IDS.admin,
        fullName: 'Super Admin',
        email: 'admin@cierres.com',
        passwordHash,
        globalRole: GlobalRole.OWNER,
        shopIds: [IDS.panino, IDS.tutto],
      },
      {
        id: IDS.manager,
        fullName: 'Manager Multi',
        email: 'manager@cierres.com',
        passwordHash,
        globalRole: GlobalRole.MANAGER,
        shopIds: [IDS.panino, IDS.tutto],
      },
      {
        id: IDS.cashier,
        fullName: 'Cajero Panino',
        email: 'cashier@cierres.com',
        passwordHash,
        globalRole: GlobalRole.CASHIER,
        shopIds: [IDS.panino],
      },
    ];

    for (const su of seedUsers) {
      const existing = await this.users.findOne({ where: { email: su.email } });
      if (existing) {
        // Promover admin demo a Super admin (OWNER) si quedó como ADMIN.
        if (
          su.email === 'admin@cierres.com' &&
          existing.globalRole !== GlobalRole.OWNER
        ) {
          existing.globalRole = GlobalRole.OWNER;
          existing.fullName = su.fullName ?? existing.fullName;
          await this.users.save(existing);
        }
        continue;
      }
      const { shopIds, ...userData } = su;
      const user = await this.users.save(this.users.create({ ...userData, active: true }));
      for (const shopId of shopIds) {
        const shopRole =
          userData.globalRole === GlobalRole.ADMIN ||
          userData.globalRole === GlobalRole.OWNER ||
          userData.globalRole === GlobalRole.MANAGER
            ? GlobalRole.ADMIN
            : (userData.globalRole as GlobalRole);
        await this.userShops.save(
          this.userShops.create({ userId: user.id, shopId, shopRole }),
        );
      }
    }

    await this.ensureSampleClosings();
  }

  private async ensureSampleClosings() {
    const count = await this.closings.count();
    if (count > 0) return;

    const samples: Array<{
      data: Partial<CashClosing>;
      expenses?: Array<{ label: string; amount: string; category: ExpenseCategory }>;
      extras?: Array<{ type: ExtraLineType; label: string; amount: string; meta?: string }>;
    }> = [
      {
        data: {
          id: 'd1111111-1111-1111-1111-111111111114',
          shopId: IDS.panino,
          businessDate: '2026-05-14',
          posSystemAmount: '721975.00',
          cardAmount: '473475.00',
          cashAmount: '248500.00',
          declaredTotal: '721975.00',
          calculatedTotal: '721975.00',
          difference: '0.00',
          unitsSold: 66,
          cashLeftInRegister: '28500.00',
          cashWithdrawn: '220000.00',
          cashWithdrawnByName: 'Facu Odo',
          notes: 'Lleva a luz azul (efectivo)',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.cashier,
        },
      },
      {
        data: {
          id: 'd1111111-1111-1111-1111-111111111125',
          shopId: IDS.panino,
          businessDate: '2026-07-25',
          posSystemAmount: '479750.00',
          cardAmount: '306000.00',
          cashAmount: '100000.00',
          deliveryAppsAmount: '13800.00',
          transferAmount: '38000.00',
          declaredTotal: '457800.00',
          calculatedTotal: '457800.00',
          difference: '-21950.00',
          unitsSold: 45,
          cashLeftInRegister: '15000.00',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.cashier,
        },
      },
      {
        data: {
          id: 'd2222222-2222-2222-2222-222222222224',
          shopId: IDS.tutto,
          businessDate: '2026-07-24',
          posSystemAmount: '1366320.00',
          cardAmount: '854230.00',
          cashAmount: '340000.00',
          accountDniAmount: '178000.00',
          declaredTotal: '1372230.00',
          calculatedTotal: '1372230.00',
          difference: '5910.00',
          tipsAmount: '20000.00',
          cashWithdrawn: '320000.00',
          cashWithdrawnByName: 'Santiago',
          notes: 'Propina 20mil falta Seba, Mati y Kevin. Queda en caja',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.manager,
        },
        extras: [
          { type: ExtraLineType.PVS_BREAKDOWN, label: 'PVS terminal 1', amount: '162960.00' },
          { type: ExtraLineType.PVS_BREAKDOWN, label: 'PVS terminal 2', amount: '691270.00' },
          {
            type: ExtraLineType.TIP_ALLOCATION,
            label: 'Propina mozos',
            amount: '20000.00',
            meta: JSON.stringify({ employees: ['Seba', 'Mati', 'Kevin'], paid: false }),
          },
        ],
      },
      {
        data: {
          id: 'd1111111-1111-1111-1111-111111111121',
          shopId: IDS.panino,
          businessDate: '2026-05-21',
          posSystemAmount: '534675.00',
          cardAmount: '407950.00',
          cashAmount: '206900.00',
          declaredTotal: '614850.00',
          calculatedTotal: '614850.00',
          difference: '80175.00',
          unitsSold: 56,
          cashWithdrawn: '170000.00',
          cashWithdrawnByName: 'Facu Odo',
          notes: 'Lleva a tutto para fonti 170mil',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.cashier,
        },
        expenses: [
          { label: 'Mayonesa', amount: '5400.00', category: ExpenseCategory.SUPPLIES },
          { label: 'Wifi', amount: '34000.00', category: ExpenseCategory.SERVICES },
        ],
      },
    ];

    for (const s of samples) {
      const row = await this.closings.save(
        this.closings.create({
          ...s.data,
          businessDateKey: closingDateKey(String(s.data.businessDate)),
          mercadoPagoAmount: s.data.mercadoPagoAmount ?? '0.00',
          deliveryAppsAmount: s.data.deliveryAppsAmount ?? '0.00',
          transferAmount: s.data.transferAmount ?? '0.00',
          accountDniAmount: s.data.accountDniAmount ?? '0.00',
          otherAmount: '0.00',
          cashLeftInRegister: s.data.cashLeftInRegister ?? '0.00',
          cashPendingPickup: '0.00',
          cashWithdrawn: s.data.cashWithdrawn ?? '0.00',
          tipsAmount: s.data.tipsAmount ?? '0.00',
          submittedAt: new Date(),
          active: true,
        }),
      );
      if (s.expenses?.length) {
        await this.expenses.save(
          s.expenses.map((e) =>
            this.expenses.create({
              closingId: row.id,
              label: e.label,
              amount: e.amount,
              category: e.category,
            }),
          ),
        );
      }
      if (s.extras?.length) {
        await this.extras.save(
          s.extras.map((e) =>
            this.extras.create({
              closingId: row.id,
              type: e.type,
              label: e.label,
              amount: e.amount,
              meta: e.meta ?? null,
            }),
          ),
        );
      }
    }
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase().trim() },
      select: ['id', 'email', 'fullName', 'globalRole', 'passwordHash', 'active'],
    });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');
    if (!isEntityActive(user.active)) {
      throw new UnauthorizedException(
        'Usuario desactivado. Contactá a un administrador.',
      );
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');

    return this.issueSession(user.id);
  }

  /**
   * Login con Google Identity Services.
   * Solo si el email del token ya existe en el sistema (no crea usuarios).
   * Completa nombre/foto/etc. solo cuando el usuario aún no los tiene.
   */
  async loginWithGoogle(dto: GoogleLoginDto) {
    const clientId = (this.config.get<string>('google.clientId') || '').trim();
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Login con Google no está configurado. Pedile a un admin que cargue GOOGLE_CLIENT_ID.',
      );
    }

    const client = new OAuth2Client(clientId);
    let payload: {
      email?: string | null;
      email_verified?: boolean | string;
      name?: string | null;
      given_name?: string | null;
      family_name?: string | null;
      picture?: string | null;
    };
    try {
      const ticket = await client.verifyIdToken({
        idToken: dto.idToken,
        audience: clientId,
      });
      payload = ticket.getPayload() ?? {};
    } catch {
      throw new UnauthorizedException('Token de Google inválido o vencido');
    }

    const email = String(payload.email || '')
      .toLowerCase()
      .trim();
    if (!email) {
      throw new UnauthorizedException('Google no devolvió un email');
    }
    const verified =
      payload.email_verified === true || payload.email_verified === 'true';
    if (!verified) {
      throw new UnauthorizedException('El email de Google no está verificado');
    }

    const user = await this.users.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException(
        'No hay un usuario con ese correo. Pedile a un administrador que te cree la cuenta primero.',
      );
    }
    if (!isEntityActive(user.active)) {
      throw new UnauthorizedException(
        'Usuario desactivado. Contactá a un administrador.',
      );
    }

    await this.enrichUserFromGoogle(user, payload);
    return this.issueSession(user.id);
  }

  private async issueSession(userId: string) {
    const profile = await this.buildAuthUser(userId);
    const accessToken = await this.jwt.signAsync({
      sub: profile.id,
      email: profile.email,
      role: profile.globalRole,
    });
    return { accessToken, user: profile };
  }

  private async enrichUserFromGoogle(
    user: User,
    payload: {
      name?: string | null;
      given_name?: string | null;
      family_name?: string | null;
      picture?: string | null;
    },
  ): Promise<void> {
    const patch: Partial<User> = {};

    const googleName = String(payload.name || '')
      .trim()
      .replace(/\s+/g, ' ');
    const composed = [payload.given_name, payload.family_name]
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .join(' ');
    const nextName = googleName || composed;
    if (nextName && !String(user.fullName || '').trim()) {
      patch.fullName = nextName;
    }

    const picture = String(payload.picture || '').trim();
    if (picture && !String(user.avatarUrl || '').trim()) {
      const saved = await this.trySaveGoogleAvatar(user.id, picture);
      patch.avatarUrl = saved || picture;
    }

    if (Object.keys(patch).length) {
      await this.users.update({ id: user.id }, patch);
    }
  }

  private async trySaveGoogleAvatar(
    userId: string,
    pictureUrl: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(pictureUrl, {
        redirect: 'follow',
        headers: { Accept: 'image/*,*/*' },
      });
      if (!res.ok) return null;
      const mime = (res.headers.get('content-type') || 'image/jpeg')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (mime && !mime.startsWith('image/')) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null;
      const saved = saveUploadFile({
        relativeDir: `users/${userId}`,
        basename: 'avatar',
        buffer,
        originalName: 'avatar.jpg',
        mime: mime || 'image/jpeg',
      });
      return saved.relativePath;
    } catch {
      return null;
    }
  }

  async buildAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !isEntityActive(user.active)) {
      throw new UnauthorizedException('Usuario desactivado');
    }
    const role = user.globalRole;
    const links = await this.userShops.find({ where: { userId } });
    let shopIds: string[];
    // Solo Super admin ve todos los locales. ADMIN (admin de local) solo los asignados.
    if (isSuperAdmin(role)) {
      const all = await this.shops.find({ where: { active: true } });
      shopIds = all.map((s) => s.id);
    } else {
      shopIds = links.map((l) => l.shopId);
    }
    const shopRoles: Record<string, string> = {};
    const shopPermissions: Record<string, Permission[]> = {};
    const shopModulePermissions: Record<string, Record<string, string>> = {};
    const shopCanEditExpenses: Record<string, boolean> = {};
    const shopCanEditPayments: Record<string, boolean> = {};

    for (const id of shopIds) {
      const link = links.find((l) => l.shopId === id);
      const effectiveRole = (link?.shopRole ?? role) as GlobalRole;
      shopRoles[id] = effectiveRole;
      shopCanEditExpenses[id] = !!link?.canEditExpenses;
      shopCanEditPayments[id] = !!link?.canEditPayments;

      if (isGlobalAdmin(role)) {
        shopPermissions[id] = [...ALL_PERMISSIONS_LIST];
        shopModulePermissions[id] = deriveModulesFromRole(GlobalRole.OWNER) as Record<
          string,
          string
        >;
        continue;
      }

      let modules: ModulePermissionsMap;
      // null = legacy (derivar del rol); objeto (aunque vacío) = explícito.
      if (link?.modulePermissions != null) {
        modules = link.modulePermissions as ModulePermissionsMap;
      } else {
        modules = deriveModulesFromRole(effectiveRole);
      }
      shopModulePermissions[id] = modules as Record<string, string>;
      shopPermissions[id] = expandModulePermissions(modules);
    }

    const linked = shopIds.length
      ? await this.accountLinks.find({
          where: { userId, shopId: In(shopIds) },
        })
      : [];
    const shopAccountIds: Record<string, string[]> = {};
    for (const l of linked) {
      const arr = shopAccountIds[l.shopId] ?? [];
      arr.push(l.accountId);
      shopAccountIds[l.shopId] = arr;
    }

    const permissions = isGlobalAdmin(role)
      ? [...ALL_PERMISSIONS_LIST]
      : (() => {
          const set = new Set<Permission>();
          for (const list of Object.values(shopPermissions)) {
            for (const p of list) set.add(p);
          }
          return [...set];
        })();

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      globalRole: role,
      shopIds,
      shopRoles,
      shopAccountIds,
      shopPermissions,
      shopModulePermissions,
      shopCanEditExpenses,
      shopCanEditPayments,
      permissions,
      favoriteShopId:
        user.favoriteShopId && shopIds.includes(user.favoriteShopId)
          ? user.favoriteShopId
          : null,
    };
  }

  async setFavoriteShop(userId: string, shopId: string | null) {
    const profile = await this.buildAuthUser(userId);
    const next =
      shopId && profile.shopIds.includes(shopId) ? shopId : null;
    await this.users.update({ id: userId }, { favoriteShopId: next });
    return this.me(userId);
  }

  async me(userId: string) {
    const profile = await this.buildAuthUser(userId);
    const user = await this.users.findOne({ where: { id: userId } });
    const links = await this.userShops.find({ where: { userId } });
    const shops =
      profile.shopIds.length > 0
        ? await this.shops.find({ where: { id: In(profile.shopIds), active: true } })
        : [];
    const settleShopIds = new Set<string>();
    if (shops.length) {
      const settleRows = await this.closingSources.find({
        where: {
          shopId: In(shops.map((s) => s.id)),
          active: true,
          kind: In([ClosingSourceKind.SETTLE_CASH, ClosingSourceKind.SETTLE_ACCOUNT]),
        },
        select: ['shopId'],
      });
      for (const row of settleRows) settleShopIds.add(row.shopId);
    }
    return {
      ...profile,
      phone: user?.phone ?? null,
      bankAlias: user?.bankAlias ?? null,
      cbu: user?.cbu ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      hasAvatar: !!user?.avatarUrl,
      shops: shops.map((s) => {
        const link = links.find((l) => l.shopId === s.id);
        return {
        id: s.id,
        name: s.name,
        slug: s.slug,
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
        reservationInsideMaxPartySize:
          s.reservationInsideMaxPartySize == null
            ? null
            : Number(s.reservationInsideMaxPartySize) || null,
        reservationOutsideMinPartySize:
          s.reservationOutsideMinPartySize == null
            ? null
            : Number(s.reservationOutsideMinPartySize) || null,
        waitingListEnabled: !!s.waitingListEnabled,
        tipsEnabled: !!s.tipsEnabled,
        settlementsEnabled: settleShopIds.has(s.id),
        publicAttendanceEnabled: !!s.publicAttendanceEnabled,
        publicServiceRulesEnabled: !!s.publicServiceRulesEnabled,
        serviceDefaultCheckIn: s.serviceDefaultCheckIn || '18:00',
        serviceDefaultCheckOut: s.serviceDefaultCheckOut || '00:00',
        serviceAttendanceWithHours:
          s.serviceAttendanceWithHours === undefined || s.serviceAttendanceWithHours === null
            ? true
            : !!s.serviceAttendanceWithHours,
        menuEnabled: !!s.menuEnabled,
        defaultChangeAmount: Number(s.defaultChangeAmount),
        productionDefaultHours: Number(s.productionDefaultHours ?? 8) || 8,
        currency: s.currency,
        timezone: s.timezone,
        openingTime: s.openingTime ?? '10:00',
        shifts: Array.isArray(s.shifts) ? s.shifts : [],
        closedWeekdays: Array.isArray(s.closedWeekdays) ? s.closedWeekdays : [],
        logoUrl: s.logoUrl ?? null,
        accentColor: s.accentColor ?? null,
        accentSecondary: s.accentSecondary ?? null,
        email: s.email ?? null,
        instagramHandle: s.instagramHandle ?? null,
        phone: s.phone ?? null,
        emailNotificationsEnabled:
          s.emailNotificationsEnabled === undefined || s.emailNotificationsEnabled === null
            ? true
            : !!s.emailNotificationsEnabled,
        salesSystemId: s.salesSystemId ?? null,
        posnets: s.posnets ?? [],
        navConfig: s.navConfig && typeof s.navConfig === 'object' ? s.navConfig : null,
        myNavConfig: link?.navConfig && typeof link.navConfig === 'object' ? link.navConfig : null,
        mutedNotificationTypes: Array.isArray(link?.mutedNotificationTypes)
          ? link!.mutedNotificationTypes
          : [],
        isStockAdmin: !!link?.isStockAdmin,
        isBeverageStockAdmin: !!link?.isBeverageStockAdmin,
        isShortageAdmin: !!link?.isShortageAdmin,
        isReservationAdmin: !!link?.isReservationAdmin,
        canEditExpenses: !!link?.canEditExpenses,
        canEditPayments: !!link?.canEditPayments,
        active: true,
      };
      }),
    };
  }
}
