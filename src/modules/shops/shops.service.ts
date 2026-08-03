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

const SHOP_ADMIN_ROLES = new Set([
  GlobalRole.OWNER,
  GlobalRole.ADMIN,
  GlobalRole.MANAGER,
]);

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const POSNET_TYPES = new Set(Object.values(PosnetType));

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
  }

  assertShopAccess(user: AuthUser, shopId: string) {
    if (isSuperAdmin(user.globalRole as GlobalRole)) return;
    if (!user.shopIds.includes(shopId)) {
      throw new ForbiddenException('Sin acceso a este local');
    }
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
    return this.toDto(shop);
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
    return rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      ledgerAccounts: accountsByUser.get(u.id) ?? [],
    }));
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
        defaultChangeAmount: String(dto.defaultChangeAmount ?? 0),
        timezone: dto.timezone ?? 'America/Argentina/Buenos_Aires',
        openingTime: normalizeOpeningTime(dto.openingTime),
        currency: dto.currency ?? 'ARS',
        logoUrl: normalizeLogoUrl(dto.logoUrl),
        accentColor: this.normalizeAccent(dto.accentColor),
        salesSystemId: dto.salesSystemId ?? null,
        posPaymentMap: dto.posPaymentMap ?? null,
        posnets: this.normalizePosnets(dto.posnets),
        active: true,
      }),
    );
    await this.catalogSeed.ensureShopCatalogs(shop.id);
    return this.toDto(shop);
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
    if (dto.timezone !== undefined) shop.timezone = dto.timezone;
    if (dto.openingTime !== undefined) {
      shop.openingTime = normalizeOpeningTime(dto.openingTime);
    }
    if (dto.currency !== undefined) shop.currency = dto.currency;
    if (dto.active !== undefined) shop.active = isEntityActive(dto.active);
    if (dto.defaultChangeAmount !== undefined) {
      shop.defaultChangeAmount = String(dto.defaultChangeAmount);
    }
    if (dto.logoUrl !== undefined) {
      shop.logoUrl = normalizeLogoUrl(dto.logoUrl);
    }
    if (dto.accentColor !== undefined) {
      shop.accentColor = this.normalizeAccent(dto.accentColor);
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
    return this.toDto(shop);
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

  toDto(s: Shop) {
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      timezone: s.timezone,
      openingTime: normalizeOpeningTime(s.openingTime),
      currency: s.currency,
      unitsLabel: s.unitsLabel,
      coversEnabled: !!s.coversEnabled,
      defaultChangeAmount: Number(s.defaultChangeAmount),
      logoUrl: s.logoUrl ?? null,
      accentColor: s.accentColor ?? null,
      salesSystemId: s.salesSystemId ?? null,
      posPaymentMap: s.posPaymentMap ?? null,
      posnets: s.posnets ?? [],
      active: isEntityActive(s.active),
    };
  }
}
