import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole } from '../../common/enums';
import { isGlobalAdmin, isSuperAdmin } from '../../common/guards';
import { markDeletedUnique } from '../../common/soft-delete.util';
import {
  deriveModulesFromRole,
  ModulePermissionsMap,
  sanitizeModulePermissions,
} from '../../common/module-permissions';
import { isEntityActive } from '../../common/active.util';
import {
  defaultUserVisibility,
  mergeUserVisibility,
  normalizeUserVisibility,
  UserVisibility,
} from '../../common/user-visibility';

const SHOP_ADMIN_ROLES = new Set([GlobalRole.OWNER, GlobalRole.ADMIN]);

/** Roles que un admin de local puede asignar como tipo de cuenta. */
const ASSIGNABLE_BY_SHOP_ADMIN = new Set([
  GlobalRole.MANAGER,
  GlobalRole.CASHIER,
  GlobalRole.VIEWER,
  GlobalRole.PARTNER,
]);

export class CreateUserBody {
  fullName: string;
  email: string;
  password: string;
  globalRole: GlobalRole;
  shopIds?: string[];
  shopRole?: GlobalRole;
  modulePermissions?: Record<string, string> | null;
  ledgerAccountIds?: string[] | null;
  /** Compat 1 cuenta. */
  ledgerAccountId?: string | null;
  /** @deprecated Preferir `visibility.cashWithdraw` (invertido). */
  hideFromCashWithdraw?: boolean;
  /** Dónde se muestra (true = visible) para el shopId del request. */
  visibility?: Partial<UserVisibility> | null;
  /** Administrador de stock alimentos: recibe alertas de stock bajo mínimo. */
  isStockAdmin?: boolean;
  /** Administrador de stock bebidas: recibe alertas de stock bebidas bajo mínimo. */
  isBeverageStockAdmin?: boolean;
  /** Administrador de faltantes: recibe notificaciones/mails del módulo Faltantes. */
  isShortageAdmin?: boolean;
  /** Administrador de reservas: recibe notificaciones y mails de solicitudes. */
  isReservationAdmin?: boolean;
  canEditExpenses?: boolean;
  canEditPayments?: boolean;
  canConfigureOpeningBalances?: boolean;
  phone?: string | null;
  bankAlias?: string | null;
  cbu?: string | null;
}

export class UpdateUserBody {
  fullName?: string;
  email?: string;
  password?: string;
  globalRole?: GlobalRole;
  active?: boolean;
  shopIds?: string[];
  shopRole?: GlobalRole;
  modulePermissions?: Record<string, string> | null;
  ledgerAccountIds?: string[] | null;
  ledgerAccountId?: string | null;
  /** @deprecated Preferir `visibility.cashWithdraw` (invertido). */
  hideFromCashWithdraw?: boolean;
  /** Dónde se muestra (true = visible) para el shopId del request. */
  visibility?: Partial<UserVisibility> | null;
  /** Administrador de stock alimentos: recibe alertas de stock bajo mínimo. */
  isStockAdmin?: boolean;
  /** Administrador de stock bebidas: recibe alertas de stock bebidas bajo mínimo. */
  isBeverageStockAdmin?: boolean;
  /** Administrador de faltantes: recibe notificaciones/mails del módulo Faltantes. */
  isShortageAdmin?: boolean;
  /** Administrador de reservas: recibe notificaciones y mails de solicitudes. */
  isReservationAdmin?: boolean;
  canEditExpenses?: boolean;
  canEditPayments?: boolean;
  canConfigureOpeningBalances?: boolean;
  phone?: string | null;
  bankAlias?: string | null;
  cbu?: string | null;
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(LedgerAccountUser)
    private readonly accountLinks: Repository<LedgerAccountUser>,
  ) {}

  async onModuleInit() {
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN hideFromCashWithdraw TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN visibility JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        UPDATE user_shops
        SET visibility = JSON_OBJECT(
          'cashWithdraw', IF(IFNULL(hideFromCashWithdraw, 0) = 0, TRUE, FALSE),
          'closingsFilters', TRUE,
          'payments', TRUE,
          'movements', TRUE,
          'employeeLink', TRUE,
          'usersList', TRUE
        )
        WHERE visibility IS NULL
      `);
    } catch {
      // skip si el motor no soporta JSON_OBJECT (raro en MySQL 8)
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN isStockAdmin TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN isBeverageStockAdmin TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN isShortageAdmin TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN isReservationAdmin TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN canEditExpenses TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN canEditPayments TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN canConfigureOpeningBalances TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN navConfig JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN mutedNotificationTypes JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN mutedAppNotificationTypes JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN mutedEmailNotificationTypes JSON NULL
      `);
    } catch {
      // columna ya existe
    }
    const userCols: Array<[string, string]> = [
      ['avatarUrl', 'VARCHAR(500) NULL'],
      ['phone', 'VARCHAR(40) NULL'],
      ['bankAlias', 'VARCHAR(120) NULL'],
      ['cbu', 'VARCHAR(40) NULL'],
    ];
    for (const [col, def] of userCols) {
      try {
        await this.users.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
      } catch {
        // ya existe
      }
    }
  }

  /** Admin global, permiso users.manage, o admin/owner del local. */
  assertShopUserAdmin(user: AuthUser, shopId: string) {
    if (isSuperAdmin(user.globalRole as GlobalRole)) return;
    if (!user.shopIds.includes(shopId)) {
      throw new ForbiddenException('Sin acceso a este local');
    }
    if (isGlobalAdmin(user.globalRole as GlobalRole)) return;
    if (user.shopPermissions?.[shopId]?.includes('users.manage')) return;
    const role = (user.shopRoles?.[shopId] ?? user.globalRole) as GlobalRole;
    if (SHOP_ADMIN_ROLES.has(role)) return;
    throw new ForbiddenException('Solo un administrador del local puede gestionar usuarios');
  }

  canManageUsersSomewhere(user: AuthUser): boolean {
    if (isGlobalAdmin(user.globalRole as GlobalRole)) return true;
    if (user.permissions.includes('users.manage')) return true;
    return user.shopIds.some((id) => {
      if (user.shopPermissions?.[id]?.includes('users.manage')) return true;
      const role = (user.shopRoles?.[id] ?? user.globalRole) as GlobalRole;
      return SHOP_ADMIN_ROLES.has(role);
    });
  }

  managedShopIds(user: AuthUser): string[] | null {
    // Solo Super admin ve usuarios de todos los locales.
    if (isSuperAdmin(user.globalRole as GlobalRole)) return null;
    if (isGlobalAdmin(user.globalRole as GlobalRole)) {
      return [...user.shopIds];
    }
    return user.shopIds.filter((id) => {
      if (user.shopPermissions?.[id]?.includes('users.manage')) return true;
      const role = (user.shopRoles?.[id] ?? user.globalRole) as GlobalRole;
      return SHOP_ADMIN_ROLES.has(role);
    });
  }

  async list(actor: AuthUser, shopId?: string) {
    if (!this.canManageUsersSomewhere(actor)) {
      throw new ForbiddenException('Sin permiso para ver usuarios');
    }

    if (shopId) {
      this.assertShopUserAdmin(actor, shopId);
      return this.listByShop(shopId);
    }

    const scope = this.managedShopIds(actor);
    if (scope === null) {
      const rows = await this.users.find({ order: { fullName: 'ASC' } });
      const links = await this.userShops.find();
      return rows.map((u) => this.toDto(u, links));
    }

    if (!scope.length) return [];
    const links = await this.userShops.find({ where: { shopId: In(scope) } });
    const ids = [...new Set(links.map((l) => l.userId))];
    if (!ids.length) return [];
    const rows = await this.users.find({
      where: { id: In(ids) },
      order: { fullName: 'ASC' },
    });
    return rows.map((u) => this.toDto(u, links));
  }

  async listByShop(shopId: string) {
    const links = await this.userShops.find({ where: { shopId } });
    const ids = links.map((l) => l.userId);
    if (!ids.length) return [];
    const rows = await this.users.find({
      where: { id: In(ids) },
      order: { fullName: 'ASC' },
    });
    const allLinks = await this.userShops.find({ where: { userId: In(ids) } });
    const accountLinks = await this.accountLinks.find({
      where: { shopId, userId: In(ids) },
    });
    const accountIds = [...new Set(accountLinks.map((l) => l.accountId))];
    const accounts = accountIds.length
      ? await this.accounts.find({ where: { id: In(accountIds), active: true } })
      : [];
    const nameByAccount = new Map(accounts.map((a) => [a.id, a.name]));
    const accountsByUser = new Map<string, string[]>();
    for (const l of accountLinks) {
      const arr = accountsByUser.get(l.userId) ?? [];
      arr.push(l.accountId);
      accountsByUser.set(l.userId, arr);
    }
    return rows.map((u) => {
      const dto = this.toDto(u, allLinks);
      const link = links.find((l) => l.userId === u.id);
      const ledgerAccountIds = accountsByUser.get(u.id) ?? [];
      const ledgerAccountNames = ledgerAccountIds
        .map((id) => nameByAccount.get(id))
        .filter(Boolean) as string[];
      return {
        ...dto,
        shopRole: link?.shopRole ?? u.globalRole,
        modulePermissions: this.effectiveModulesForLink(link, u.globalRole),
        ...this.visibilityPayload(link),
        isStockAdmin: !!link?.isStockAdmin,
        isBeverageStockAdmin: !!link?.isBeverageStockAdmin,
        isShortageAdmin: !!link?.isShortageAdmin,
        isReservationAdmin: !!link?.isReservationAdmin,
        canEditExpenses: !!link?.canEditExpenses,
        canEditPayments: !!link?.canEditPayments,
        canConfigureOpeningBalances: !!link?.canConfigureOpeningBalances,
        ledgerAccountIds,
        ledgerAccountNames,
        ledgerAccountId: ledgerAccountIds[0] ?? null,
        ledgerAccountName: ledgerAccountNames.join(', ') || null,
      };
    });
  }

  async create(actor: AuthUser, dto: CreateUserBody, defaultShopId?: string) {
    if (!this.canManageUsersSomewhere(actor)) {
      throw new ForbiddenException('Sin permiso para crear usuarios');
    }

    const shopIds = [...new Set([...(dto.shopIds ?? []), ...(defaultShopId ? [defaultShopId] : [])])];
    if (!shopIds.length) {
      throw new BadRequestException('Asigná al menos un local');
    }

    for (const sid of shopIds) {
      this.assertShopUserAdmin(actor, sid);
    }

    this.assertAssignableRole(actor, dto.globalRole);
    const allowUsersModule = isGlobalAdmin(actor.globalRole as GlobalRole);
    const modules = this.resolveIncomingModules(actor, dto, allowUsersModule);

    const email = dto.email.toLowerCase().trim();
    const exists = await this.users.findOne({ where: { email } });
    if (exists) throw new BadRequestException('Ya existe un usuario con ese correo');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.save(
      this.users.create({
        fullName: dto.fullName.trim(),
        email,
        passwordHash,
        globalRole: dto.globalRole,
        phone: dto.phone?.trim() ? dto.phone.trim() : null,
        bankAlias: dto.bankAlias?.trim() ? dto.bankAlias.trim() : null,
        cbu: dto.cbu?.trim() ? dto.cbu.trim() : null,
        active: true,
      }),
    );

    for (const shopId of shopIds) {
      const visibility =
        defaultShopId === shopId
          ? this.resolveVisibilityFromDto(dto)
          : defaultUserVisibility();
      await this.userShops.save(
        this.userShops.create({
          userId: user.id,
          shopId,
          shopRole: dto.shopRole ?? dto.globalRole,
          modulePermissions: isGlobalAdmin(dto.globalRole)
            ? null
            : (modules as Record<string, string>),
          visibility,
          hideFromCashWithdraw: !visibility.cashWithdraw,
          isStockAdmin: defaultShopId === shopId ? !!dto.isStockAdmin : false,
          isBeverageStockAdmin:
            defaultShopId === shopId ? !!dto.isBeverageStockAdmin : false,
          isShortageAdmin: defaultShopId === shopId ? !!dto.isShortageAdmin : false,
          isReservationAdmin: defaultShopId === shopId ? !!dto.isReservationAdmin : false,
          canEditExpenses:
            defaultShopId === shopId && isSuperAdmin(actor.globalRole as GlobalRole)
              ? !!dto.canEditExpenses
              : false,
          canEditPayments:
            defaultShopId === shopId && isSuperAdmin(actor.globalRole as GlobalRole)
              ? !!dto.canEditPayments
              : false,
          canConfigureOpeningBalances:
            defaultShopId === shopId && isSuperAdmin(actor.globalRole as GlobalRole)
              ? !!dto.canConfigureOpeningBalances
              : false,
        }),
      );
    }

    if (defaultShopId && (dto.ledgerAccountIds !== undefined || dto.ledgerAccountId !== undefined)) {
      await this.replaceAccountLinks(defaultShopId, user.id, this.normalizeAccountIds(dto));
    }

    return this.one(actor, user.id, defaultShopId);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserBody, shopId?: string) {
    if (!this.canManageUsersSomewhere(actor)) {
      throw new ForbiddenException('Sin permiso para editar usuarios');
    }

    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const links = await this.userShops.find({ where: { userId: id } });
    const userShopIds = links.map((l) => l.shopId);

    if (shopId) {
      this.assertShopUserAdmin(actor, shopId);
      if (!userShopIds.includes(shopId) && !(dto.shopIds ?? []).includes(shopId)) {
        // permitir agregar al local al editar
      }
    } else {
      const scope = this.managedShopIds(actor);
      if (scope !== null) {
        const overlap = userShopIds.some((s) => scope.includes(s));
        if (!overlap && !(dto.shopIds ?? []).some((s) => scope.includes(s))) {
          throw new ForbiddenException('No podés editar usuarios de otros locales');
        }
      }
    }

    if (dto.globalRole !== undefined) {
      this.assertAssignableRole(actor, dto.globalRole);
      // shop admin no puede bajar/editar a un ADMIN/OWNER global
      if (!isGlobalAdmin(actor.globalRole as GlobalRole)) {
        if (
          user.globalRole === GlobalRole.OWNER ||
          user.globalRole === GlobalRole.ADMIN
        ) {
          throw new ForbiddenException('No podés editar un administrador global');
        }
      }
      user.globalRole = dto.globalRole;
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) {
      user.phone = dto.phone?.trim() ? dto.phone.trim() : null;
    }
    if (dto.bankAlias !== undefined) {
      user.bankAlias = dto.bankAlias?.trim() ? dto.bankAlias.trim() : null;
    }
    if (dto.cbu !== undefined) {
      user.cbu = dto.cbu?.trim() ? dto.cbu.trim() : null;
    }
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      const clash = await this.users.findOne({ where: { email } });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Ya existe un usuario con ese correo');
      }
      user.email = email;
    }
    if (dto.active !== undefined) {
      const nextActive = isEntityActive(dto.active);
      if (!nextActive && actor.id === id) {
        throw new BadRequestException('No podés desactivar tu propio usuario');
      }
      user.active = nextActive;
    }
    if (dto.password?.trim()) {
      user.passwordHash = await bcrypt.hash(dto.password.trim(), 10);
    }

    await this.users.save(user);

    const allowUsersModule = isGlobalAdmin(actor.globalRole as GlobalRole);
    const modulesIncoming =
      dto.modulePermissions !== undefined
        ? this.resolveIncomingModules(actor, dto, allowUsersModule)
        : undefined;

    if (dto.shopIds) {
      const nextIds = [...new Set(dto.shopIds)];
      for (const sid of nextIds) {
        this.assertShopUserAdmin(actor, sid);
      }
      // Shop admin: solo puede tocar membresías de locales que administra
      const scope = this.managedShopIds(actor);
      if (scope !== null) {
        const removable = links.filter((l) => scope.includes(l.shopId));
        for (const l of removable) {
          if (!nextIds.includes(l.shopId)) {
            await this.userShops.delete({ id: l.id });
          }
        }
        for (const sid of nextIds) {
          if (!scope.includes(sid)) continue;
          const exists = await this.userShops.findOne({ where: { userId: id, shopId: sid } });
          if (!exists) {
            const visibility =
              shopId === sid ? this.resolveVisibilityFromDto(dto) : defaultUserVisibility();
            await this.userShops.save(
              this.userShops.create({
                userId: id,
                shopId: sid,
                shopRole: dto.shopRole ?? user.globalRole,
                modulePermissions: isGlobalAdmin(user.globalRole)
                  ? null
                  : ((modulesIncoming ??
                      deriveModulesFromRole(
                        (dto.shopRole ?? user.globalRole) as GlobalRole,
                      )) as Record<string, string>),
                visibility,
                hideFromCashWithdraw: !visibility.cashWithdraw,
                isStockAdmin: shopId === sid ? !!dto.isStockAdmin : false,
                isBeverageStockAdmin:
                  shopId === sid ? !!dto.isBeverageStockAdmin : false,
                isShortageAdmin: shopId === sid ? !!dto.isShortageAdmin : false,
                isReservationAdmin: shopId === sid ? !!dto.isReservationAdmin : false,
                ...this.editFlagsFromDto(actor, dto, undefined, shopId === sid),
              }),
            );
          } else {
            if (dto.shopRole) exists.shopRole = dto.shopRole;
            if (modulesIncoming !== undefined) {
              exists.modulePermissions = isGlobalAdmin(user.globalRole)
                ? null
                : (modulesIncoming as Record<string, string>);
            }
            if (shopId === sid && this.hasVisibilityPatch(dto)) {
              const visibility = this.resolveVisibilityFromDto(dto, exists);
              exists.visibility = visibility;
              exists.hideFromCashWithdraw = !visibility.cashWithdraw;
            }
            if (shopId === sid && dto.isStockAdmin !== undefined) {
              exists.isStockAdmin = !!dto.isStockAdmin;
            }
            if (shopId === sid && dto.isBeverageStockAdmin !== undefined) {
              exists.isBeverageStockAdmin = !!dto.isBeverageStockAdmin;
            }
            if (shopId === sid && dto.isShortageAdmin !== undefined) {
              exists.isShortageAdmin = !!dto.isShortageAdmin;
            }
            if (shopId === sid && dto.isReservationAdmin !== undefined) {
              exists.isReservationAdmin = !!dto.isReservationAdmin;
            }
            if (shopId === sid && isSuperAdmin(actor.globalRole as GlobalRole)) {
              if (dto.canEditExpenses !== undefined) exists.canEditExpenses = !!dto.canEditExpenses;
              if (dto.canEditPayments !== undefined) exists.canEditPayments = !!dto.canEditPayments;
              if (dto.canConfigureOpeningBalances !== undefined) {
                exists.canConfigureOpeningBalances = !!dto.canConfigureOpeningBalances;
              }
            }
            await this.userShops.save(exists);
          }
        }
      } else {
        const prevVisibility = new Map(
          links.map((l) => [l.shopId, this.linkVisibility(l)]),
        );
        const prevStockAdmin = new Map(links.map((l) => [l.shopId, !!l.isStockAdmin]));
        const prevBeverageStockAdmin = new Map(
          links.map((l) => [l.shopId, !!l.isBeverageStockAdmin]),
        );
        const prevShortageAdmin = new Map(
          links.map((l) => [l.shopId, !!l.isShortageAdmin]),
        );
        const prevReservationAdmin = new Map(
          links.map((l) => [l.shopId, !!l.isReservationAdmin]),
        );
        const prevEditExpenses = new Map(links.map((l) => [l.shopId, !!l.canEditExpenses]));
        const prevEditPayments = new Map(links.map((l) => [l.shopId, !!l.canEditPayments]));
        const prevOpeningBalances = new Map(
          links.map((l) => [l.shopId, !!l.canConfigureOpeningBalances]),
        );
        await this.userShops.delete({ userId: id });
        for (const sid of nextIds) {
          const visibility =
            shopId === sid && this.hasVisibilityPatch(dto)
              ? this.resolveVisibilityFromDto(dto, {
                  visibility: prevVisibility.get(sid),
                  hideFromCashWithdraw: !prevVisibility.get(sid)?.cashWithdraw,
                } as UserShop)
              : (prevVisibility.get(sid) ?? defaultUserVisibility());
          const stockAdmin =
            shopId === sid && dto.isStockAdmin !== undefined
              ? !!dto.isStockAdmin
              : (prevStockAdmin.get(sid) ?? false);
          const beverageStockAdmin =
            shopId === sid && dto.isBeverageStockAdmin !== undefined
              ? !!dto.isBeverageStockAdmin
              : (prevBeverageStockAdmin.get(sid) ?? false);
          const shortageAdmin =
            shopId === sid && dto.isShortageAdmin !== undefined
              ? !!dto.isShortageAdmin
              : (prevShortageAdmin.get(sid) ?? false);
          const reservationAdmin =
            shopId === sid && dto.isReservationAdmin !== undefined
              ? !!dto.isReservationAdmin
              : (prevReservationAdmin.get(sid) ?? false);
          const editFlags = this.editFlagsFromDto(
            actor,
            dto,
            {
              canEditExpenses: prevEditExpenses.get(sid),
              canEditPayments: prevEditPayments.get(sid),
              canConfigureOpeningBalances: prevOpeningBalances.get(sid),
            },
            shopId === sid,
          );
          await this.userShops.save(
            this.userShops.create({
              userId: id,
              shopId: sid,
              shopRole: dto.shopRole ?? user.globalRole,
              modulePermissions: isGlobalAdmin(user.globalRole)
                ? null
                : ((modulesIncoming ??
                    deriveModulesFromRole(
                      (dto.shopRole ?? user.globalRole) as GlobalRole,
                    )) as Record<string, string>),
              visibility,
              hideFromCashWithdraw: !visibility.cashWithdraw,
              isStockAdmin: stockAdmin,
              isBeverageStockAdmin: beverageStockAdmin,
              isShortageAdmin: shortageAdmin,
              isReservationAdmin: reservationAdmin,
              canEditExpenses: editFlags.canEditExpenses,
              canEditPayments: editFlags.canEditPayments,
              canConfigureOpeningBalances: editFlags.canConfigureOpeningBalances,
            }),
          );
        }
      }
    } else if (
      shopId &&
      (dto.shopRole ||
        modulesIncoming !== undefined ||
        this.hasVisibilityPatch(dto) ||
        dto.isStockAdmin !== undefined ||
        dto.isBeverageStockAdmin !== undefined ||
        dto.isShortageAdmin !== undefined ||
        dto.isReservationAdmin !== undefined ||
        dto.canEditExpenses !== undefined ||
        dto.canEditPayments !== undefined ||
        dto.canConfigureOpeningBalances !== undefined)
    ) {
      const link = await this.userShops.findOne({ where: { userId: id, shopId } });
      if (link) {
        if (dto.shopRole) link.shopRole = dto.shopRole;
        if (modulesIncoming !== undefined) {
          link.modulePermissions = isGlobalAdmin(user.globalRole)
            ? null
            : (modulesIncoming as Record<string, string>);
        }
        if (this.hasVisibilityPatch(dto)) {
          const visibility = this.resolveVisibilityFromDto(dto, link);
          link.visibility = visibility;
          link.hideFromCashWithdraw = !visibility.cashWithdraw;
        }
        if (dto.isStockAdmin !== undefined) {
          link.isStockAdmin = !!dto.isStockAdmin;
        }
        if (dto.isBeverageStockAdmin !== undefined) {
          link.isBeverageStockAdmin = !!dto.isBeverageStockAdmin;
        }
        if (dto.isShortageAdmin !== undefined) {
          link.isShortageAdmin = !!dto.isShortageAdmin;
        }
        if (dto.isReservationAdmin !== undefined) {
          link.isReservationAdmin = !!dto.isReservationAdmin;
        }
        if (isSuperAdmin(actor.globalRole as GlobalRole)) {
          if (dto.canEditExpenses !== undefined) link.canEditExpenses = !!dto.canEditExpenses;
          if (dto.canEditPayments !== undefined) link.canEditPayments = !!dto.canEditPayments;
          if (dto.canConfigureOpeningBalances !== undefined) {
            link.canConfigureOpeningBalances = !!dto.canConfigureOpeningBalances;
          }
        }
        await this.userShops.save(link);
      } else {
        const visibility = this.resolveVisibilityFromDto(dto);
        await this.userShops.save(
          this.userShops.create({
            userId: id,
            shopId,
            shopRole: dto.shopRole ?? user.globalRole,
            modulePermissions: isGlobalAdmin(user.globalRole)
              ? null
              : ((modulesIncoming ??
                  deriveModulesFromRole(
                    (dto.shopRole ?? user.globalRole) as GlobalRole,
                  )) as Record<string, string>),
            visibility,
            hideFromCashWithdraw: !visibility.cashWithdraw,
            isStockAdmin: !!dto.isStockAdmin,
            isBeverageStockAdmin: !!dto.isBeverageStockAdmin,
            isShortageAdmin: !!dto.isShortageAdmin,
            isReservationAdmin: !!dto.isReservationAdmin,
            ...this.editFlagsFromDto(actor, dto, undefined, true),
          }),
        );
      }
    }

    if (shopId && (dto.ledgerAccountIds !== undefined || dto.ledgerAccountId !== undefined)) {
      await this.replaceAccountLinks(shopId, id, this.normalizeAccountIds(dto));
    }

    return this.one(actor, id, shopId);
  }

  /** Soft-delete permanente: solo Super admin. */
  async remove(actor: AuthUser, id: string) {
    if (!isSuperAdmin(actor.globalRole as GlobalRole)) {
      throw new ForbiddenException('Solo un super admin puede eliminar usuarios');
    }
    if (actor.id === id) {
      throw new BadRequestException('No podés eliminar tu propio usuario');
    }
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.globalRole === GlobalRole.OWNER && actor.id !== id) {
      // permitir borrar otro OWNER solo si el actor es OWNER (ya validado)
    }
    await this.accountLinks.delete({ userId: id });
    await this.userShops.delete({ userId: id });
    user.active = false;
    user.email = markDeletedUnique(user.email, user.id, 160);
    await this.users.save(user);
    await this.users.softRemove(user);
    return { ok: true };
  }

  async one(actor: AuthUser, id: string, shopId?: string) {
    if (!this.canManageUsersSomewhere(actor)) {
      throw new ForbiddenException('Sin permiso');
    }
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    const links = await this.userShops.find({ where: { userId: id } });
    const scope = this.managedShopIds(actor);
    if (scope !== null) {
      const overlap = links.some((l) => scope.includes(l.shopId));
      if (!overlap) throw new ForbiddenException('Sin acceso a este usuario');
    }
    const dto = this.toDto(u, links);
    if (!shopId) return dto;
    const accountLinks = await this.accountLinks.find({
      where: { shopId, userId: id },
    });
    const accountIds = accountLinks.map((l) => l.accountId);
    const accounts = accountIds.length
      ? await this.accounts.find({ where: { id: In(accountIds), active: true } })
      : [];
    const names = accounts.map((a) => a.name);
    const link = links.find((l) => l.shopId === shopId);
    return {
      ...dto,
      shopRole: link?.shopRole ?? u.globalRole,
      modulePermissions: this.effectiveModulesForLink(link, u.globalRole),
      ...this.visibilityPayload(link),
      isStockAdmin: !!link?.isStockAdmin,
      isBeverageStockAdmin: !!link?.isBeverageStockAdmin,
      isShortageAdmin: !!link?.isShortageAdmin,
      isReservationAdmin: !!link?.isReservationAdmin,
      canEditExpenses: !!link?.canEditExpenses,
      canEditPayments: !!link?.canEditPayments,
      canConfigureOpeningBalances: !!link?.canConfigureOpeningBalances,
      ledgerAccountIds: accountIds,
      ledgerAccountNames: names,
      ledgerAccountId: accountIds[0] ?? null,
      ledgerAccountName: names.join(', ') || null,
    };
  }

  private linkVisibility(link?: UserShop | null): UserVisibility {
    return normalizeUserVisibility(link?.visibility as Partial<UserVisibility> | null, {
      hideFromCashWithdraw: !!link?.hideFromCashWithdraw,
    });
  }

  private visibilityPayload(link?: UserShop | null) {
    const visibility = this.linkVisibility(link);
    return {
      visibility,
      hideFromCashWithdraw: !visibility.cashWithdraw,
    };
  }

  private hasVisibilityPatch(dto: {
    visibility?: Partial<UserVisibility> | null;
    hideFromCashWithdraw?: boolean;
  }): boolean {
    return dto.visibility !== undefined || dto.hideFromCashWithdraw !== undefined;
  }

  private resolveVisibilityFromDto(
    dto: {
      visibility?: Partial<UserVisibility> | null;
      hideFromCashWithdraw?: boolean;
    },
    existing?: UserShop | null,
  ): UserVisibility {
    const base = existing ? this.linkVisibility(existing) : defaultUserVisibility();
    if (dto.visibility !== undefined) {
      return mergeUserVisibility(base, dto.visibility);
    }
    if (dto.hideFromCashWithdraw !== undefined) {
      return { ...base, cashWithdraw: !dto.hideFromCashWithdraw };
    }
    return base;
  }

  private effectiveModulesForLink(
    link: UserShop | undefined,
    globalRole: GlobalRole,
  ): Record<string, string> {
    if (isGlobalAdmin(globalRole)) {
      return deriveModulesFromRole(GlobalRole.OWNER) as Record<string, string>;
    }
    // null = legacy; objeto (aunque vacío) = explícito sin módulos.
    if (link?.modulePermissions != null) {
      return link.modulePermissions;
    }
    const role = (link?.shopRole ?? globalRole) as GlobalRole;
    return deriveModulesFromRole(role) as Record<string, string>;
  }

  private resolveIncomingModules(
    actor: AuthUser,
    dto: { globalRole?: GlobalRole; shopRole?: GlobalRole; modulePermissions?: Record<string, string> | null },
    allowUsersModule: boolean,
  ): ModulePermissionsMap {
    if (dto.globalRole && isGlobalAdmin(dto.globalRole)) {
      return {};
    }
    // Explícito (incluso {} = sin módulos): no caer al preset del rol.
    if (dto.modulePermissions !== undefined && dto.modulePermissions !== null) {
      if (!allowUsersModule && dto.modulePermissions['users'] === 'manage') {
        throw new ForbiddenException('No podés asignar gestión de usuarios');
      }
      return sanitizeModulePermissions(dto.modulePermissions, { allowUsersModule });
    }
    const role = (dto.shopRole ?? dto.globalRole ?? GlobalRole.CASHIER) as GlobalRole;
    return deriveModulesFromRole(role);
  }

  private normalizeAccountIds(dto: {
    ledgerAccountIds?: string[] | null;
    ledgerAccountId?: string | null;
  }): string[] {
    if (dto.ledgerAccountIds !== undefined) {
      return [...new Set((dto.ledgerAccountIds ?? []).filter(Boolean))];
    }
    if (dto.ledgerAccountId) return [dto.ledgerAccountId];
    return [];
  }

  /** Reemplaza las cuentas asociadas al usuario en el local (N:N). */
  private async replaceAccountLinks(shopId: string, userId: string, accountIds: string[]) {
    for (const accountId of accountIds) {
      const account = await this.accounts.findOne({ where: { id: accountId, shopId, active: true } });
      if (!account) {
        throw new BadRequestException('Cuenta no encontrada en este local');
      }
    }
    await this.accountLinks.delete({ shopId, userId });
    if (!accountIds.length) return;
    await this.accountLinks.save(
      accountIds.map((accountId) =>
        this.accountLinks.create({ shopId, accountId, userId }),
      ),
    );
  }

  private assertAssignableRole(actor: AuthUser, role: GlobalRole) {
    if (isGlobalAdmin(actor.globalRole as GlobalRole)) {
      if (role === GlobalRole.OWNER && actor.globalRole !== GlobalRole.OWNER) {
        throw new ForbiddenException('Solo un super admin puede asignar el rol Super admin');
      }
      return;
    }
    if (!ASSIGNABLE_BY_SHOP_ADMIN.has(role)) {
      throw new ForbiddenException(
        'Como admin del local solo podés asignar Gerente, Cajero, Visor o Socio',
      );
    }
  }

  private editFlagsFromDto(
    actor: AuthUser,
    dto: {
      canEditExpenses?: boolean;
      canEditPayments?: boolean;
      canConfigureOpeningBalances?: boolean;
    },
    existing?: {
      canEditExpenses?: boolean;
      canEditPayments?: boolean;
      canConfigureOpeningBalances?: boolean;
    },
    apply = true,
  ): {
    canEditExpenses: boolean;
    canEditPayments: boolean;
    canConfigureOpeningBalances: boolean;
  } {
    if (!apply || !isSuperAdmin(actor.globalRole as GlobalRole)) {
      return {
        canEditExpenses: !!existing?.canEditExpenses,
        canEditPayments: !!existing?.canEditPayments,
        canConfigureOpeningBalances: !!existing?.canConfigureOpeningBalances,
      };
    }
    return {
      canEditExpenses:
        dto.canEditExpenses !== undefined ? !!dto.canEditExpenses : !!existing?.canEditExpenses,
      canEditPayments:
        dto.canEditPayments !== undefined ? !!dto.canEditPayments : !!existing?.canEditPayments,
      canConfigureOpeningBalances:
        dto.canConfigureOpeningBalances !== undefined
          ? !!dto.canConfigureOpeningBalances
          : !!existing?.canConfigureOpeningBalances,
    };
  }

  private toDto(u: User, links: UserShop[]) {
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      globalRole: u.globalRole,
      active: isEntityActive(u.active),
      phone: u.phone ?? null,
      bankAlias: u.bankAlias ?? null,
      cbu: u.cbu ?? null,
      avatarUrl: u.avatarUrl ?? null,
      hasAvatar: !!u.avatarUrl,
      shopIds: links.filter((l) => l.userId === u.id).map((l) => l.shopId),
    };
  }
}
