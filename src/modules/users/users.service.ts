import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { isGlobalAdmin } from '../../common/guards';

const SHOP_ADMIN_ROLES = new Set([GlobalRole.OWNER, GlobalRole.ADMIN]);

/** Roles que un admin de local puede asignar. */
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
  ledgerAccountIds?: string[] | null;
  /** Compat 1 cuenta. */
  ledgerAccountId?: string | null;
}

export class UpdateUserBody {
  fullName?: string;
  email?: string;
  password?: string;
  globalRole?: GlobalRole;
  active?: boolean;
  shopIds?: string[];
  shopRole?: GlobalRole;
  ledgerAccountIds?: string[] | null;
  ledgerAccountId?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(LedgerAccountUser)
    private readonly accountLinks: Repository<LedgerAccountUser>,
  ) {}

  /** Admin global o admin/owner del local. */
  assertShopUserAdmin(user: AuthUser, shopId: string) {
    if (isGlobalAdmin(user.globalRole as GlobalRole)) return;
    if (!user.shopIds.includes(shopId)) {
      throw new ForbiddenException('Sin acceso a este local');
    }
    const role = (user.shopRoles?.[shopId] ?? user.globalRole) as GlobalRole;
    if (SHOP_ADMIN_ROLES.has(role)) return;
    throw new ForbiddenException('Solo un administrador del local puede gestionar usuarios');
  }

  canManageUsersSomewhere(user: AuthUser): boolean {
    if (isGlobalAdmin(user.globalRole as GlobalRole)) return true;
    if (user.permissions.includes('users.manage')) return true;
    return user.shopIds.some((id) => {
      const role = (user.shopRoles?.[id] ?? user.globalRole) as GlobalRole;
      return SHOP_ADMIN_ROLES.has(role);
    });
  }

  managedShopIds(user: AuthUser): string[] | null {
    if (isGlobalAdmin(user.globalRole as GlobalRole)) return null; // all
    return user.shopIds.filter((id) => {
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
        active: true,
      }),
    );

    for (const shopId of shopIds) {
      await this.userShops.save(
        this.userShops.create({
          userId: user.id,
          shopId,
          shopRole: dto.globalRole,
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
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      const clash = await this.users.findOne({ where: { email } });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Ya existe un usuario con ese correo');
      }
      user.email = email;
    }
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.password?.trim()) {
      user.passwordHash = await bcrypt.hash(dto.password.trim(), 10);
    }

    await this.users.save(user);

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
            await this.userShops.save(
              this.userShops.create({
                userId: id,
                shopId: sid,
                shopRole: dto.shopRole ?? user.globalRole,
              }),
            );
          } else if (dto.shopRole) {
            exists.shopRole = dto.shopRole;
            await this.userShops.save(exists);
          }
        }
      } else {
        await this.userShops.delete({ userId: id });
        for (const sid of nextIds) {
          await this.userShops.save(
            this.userShops.create({
              userId: id,
              shopId: sid,
              shopRole: dto.shopRole ?? user.globalRole,
            }),
          );
        }
      }
    } else if (shopId && dto.shopRole) {
      const link = await this.userShops.findOne({ where: { userId: id, shopId } });
      if (link) {
        link.shopRole = dto.shopRole;
        await this.userShops.save(link);
      } else {
        await this.userShops.save(
          this.userShops.create({ userId: id, shopId, shopRole: dto.shopRole }),
        );
      }
    }

    if (shopId && (dto.ledgerAccountIds !== undefined || dto.ledgerAccountId !== undefined)) {
      await this.replaceAccountLinks(shopId, id, this.normalizeAccountIds(dto));
    }

    return this.one(actor, id, shopId);
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
      ledgerAccountIds: accountIds,
      ledgerAccountNames: names,
      ledgerAccountId: accountIds[0] ?? null,
      ledgerAccountName: names.join(', ') || null,
    };
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
        throw new ForbiddenException('No podés asignar rol Propietario');
      }
      return;
    }
    if (!ASSIGNABLE_BY_SHOP_ADMIN.has(role)) {
      throw new ForbiddenException(
        'Como admin del local solo podés asignar Gerente, Cajero, Visor o Socio',
      );
    }
  }

  private toDto(u: User, links: UserShop[]) {
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      globalRole: u.globalRole,
      active: !!u.active,
      shopIds: links.filter((l) => l.userId === u.id).map((l) => l.shopId),
    };
  }
}
