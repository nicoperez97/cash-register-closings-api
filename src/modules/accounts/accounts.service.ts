import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole, LedgerAccountType, LinkedPaymentMethod } from '../../common/enums';
import { isGlobalAdmin } from '../../common/guards';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';

export class UpsertAccountDto {
  name: string;
  code: string;
  type?: LedgerAccountType;
  linkedPaymentMethod?: LinkedPaymentMethod | null;
  /** Usuarios asociados (N:N). */
  userIds?: string[] | null;
  /** Compat: un solo usuario. */
  userId?: string | null;
  active?: boolean;
}

@Injectable()
export class AccountsService implements OnModuleInit {
  constructor(
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(LedgerAccountUser)
    private readonly links: Repository<LedgerAccountUser>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async onModuleInit() {
    try {
      const shops = await this.shopsRepo.find({ where: { active: true } });
      for (const s of shops) {
        await this.catalogSeed.ensureShopCatalogs(s.id);
      }
      await this.migrateLegacyUserIds();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AccountsService] Catalog seed failed:', err);
    }
  }

  /** Copia ledger_accounts.userId → join table si aún existen filas legacy. */
  private async migrateLegacyUserIds() {
    try {
      await this.accounts.query(`
        INSERT IGNORE INTO ledger_account_users (id, shopId, accountId, userId)
        SELECT UUID(), a.shopId, a.id, a.userId
        FROM ledger_accounts a
        WHERE a.userId IS NOT NULL
          AND (a.deletedAt IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM ledger_account_users l
            WHERE l.accountId = a.id AND l.userId = a.userId
          )
      `);
    } catch {
      // columna userId puede no existir ya
    }
  }

  private async enrich(rows: LedgerAccount[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const links = await this.links.find({ where: { accountId: In(ids) } });
    const userIds = [...new Set(links.map((l) => l.userId))];
    const users = userIds.length
      ? await this.users.find({ where: { id: In(userIds) } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    const linksByAccount = new Map<string, LedgerAccountUser[]>();
    for (const l of links) {
      const arr = linksByAccount.get(l.accountId) ?? [];
      arr.push(l);
      linksByAccount.set(l.accountId, arr);
    }
    return rows.map((a) => {
      const alinks = linksByAccount.get(a.id) ?? [];
      const uids = alinks.map((l) => l.userId);
      const names = uids.map((id) => nameById.get(id)).filter(Boolean) as string[];
      return {
        id: a.id,
        shopId: a.shopId,
        name: a.name,
        code: a.code,
        type: a.type,
        linkedPaymentMethod: a.linkedPaymentMethod ?? null,
        userIds: uids,
        userNames: names,
        userFullName: names.join(', ') || null,
        userId: uids[0] ?? null,
        active: !!a.active,
      };
    });
  }

  async list(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.catalogSeed.ensureShopCatalogs(shopId);
    const rows = await this.accounts.find({
      where: { shopId, active: true },
      order: { type: 'ASC', name: 'ASC' },
    });
    return this.enrich(rows);
  }

  async create(user: AuthUser, shopId: string, dto: UpsertAccountDto) {
    this.shops.assertShopAccess(user, shopId);
    const code = dto.code.trim().toUpperCase();
    const clash = await this.accounts.findOne({ where: { shopId, code } });
    if (clash) throw new BadRequestException('Ya existe una cuenta con ese código');
    const row = await this.accounts.save(
      this.accounts.create({
        shopId,
        name: dto.name.trim(),
        code,
        type: dto.type ?? LedgerAccountType.PARTNER,
        linkedPaymentMethod: dto.linkedPaymentMethod ?? null,
        active: dto.active ?? true,
      }),
    );
    const userIds = this.normalizeUserIds(dto);
    if (userIds.length) await this.replaceUserLinks(shopId, row.id, userIds);
    return (await this.enrich([row]))[0];
  }

  async update(user: AuthUser, shopId: string, id: string, dto: Partial<UpsertAccountDto>) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.accounts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cuenta no encontrada');
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();
      const clash = await this.accounts.findOne({ where: { shopId, code } });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Ya existe una cuenta con ese código');
      }
      row.code = code;
    }
    if (dto.type !== undefined) row.type = dto.type;
    if (dto.linkedPaymentMethod !== undefined) {
      row.linkedPaymentMethod = dto.linkedPaymentMethod;
    }
    if (dto.active !== undefined) row.active = dto.active;
    await this.accounts.save(row);
    if (dto.userIds !== undefined || dto.userId !== undefined) {
      await this.replaceUserLinks(shopId, id, this.normalizeUserIds(dto));
    }
    return (await this.enrich([row]))[0];
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.accounts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cuenta no encontrada');
    if (row.type === LedgerAccountType.SYSTEM && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException('No se pueden eliminar cuentas de sistema');
    }
    await this.links.delete({ accountId: id });
    await this.accounts.softRemove(row);
    return { ok: true };
  }

  private normalizeUserIds(dto: Partial<UpsertAccountDto>): string[] {
    if (dto.userIds !== undefined) {
      return [...new Set((dto.userIds ?? []).filter(Boolean))];
    }
    if (dto.userId) return [dto.userId];
    return [];
  }

  private async replaceUserLinks(shopId: string, accountId: string, userIds: string[]) {
    for (const userId of userIds) {
      const user = await this.users.findOne({ where: { id: userId, active: true } });
      if (!user) throw new BadRequestException(`Usuario no encontrado: ${userId}`);
    }
    await this.links.delete({ accountId });
    if (!userIds.length) return;
    await this.links.save(
      userIds.map((userId) =>
        this.links.create({ shopId, accountId, userId }),
      ),
    );
  }
}
