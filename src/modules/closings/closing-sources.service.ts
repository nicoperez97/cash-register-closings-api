import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { ShopsService } from '../shops/shops.service';
import { AuthUser } from '../../common/decorators';
import { ClosingSourceKind } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import {
  UpdateShopClosingSourceDto,
  UpsertShopClosingSourceDto,
} from './dto/closing-source.dto';

@Injectable()
export class ClosingSourcesService {
  constructor(
    @InjectRepository(ShopClosingSource)
    private readonly sources: Repository<ShopClosingSource>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    private readonly shops: ShopsService,
  ) {}

  async list(user: AuthUser, shopId: string, activeOnly = false) {
    this.shops.assertShopAccess(user, shopId);
    const where = activeOnly ? { shopId, active: true } : { shopId };
    // Sin `relations: ['account']`: el soft-delete de TypeORM a veces excluye filas
    // cuyo destino está borrado/inactivo, y la pantalla queda vacía.
    const rows = await this.sources.find({
      where,
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const accountIds = [
      ...new Set(rows.map((r) => r.accountId).filter((id): id is string => !!id)),
    ];
    const accounts = accountIds.length
      ? await this.accounts.find({
          where: { shopId, id: In(accountIds) },
          withDeleted: true,
        })
      : [];
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));
    return rows.map((r) => this.toDto(r, nameById.get(r.accountId ?? '') ?? null));
  }

  async create(user: AuthUser, shopId: string, dto: UpsertShopClosingSourceDto) {
    this.shops.assertShopAccess(user, shopId);
    const kind = dto.kind ?? ClosingSourceKind.RECORD_ONLY;
    const accountId = await this.resolveAccount(shopId, kind, dto.accountId);
    const maxSort = await this.sources
      .createQueryBuilder('s')
      .select('MAX(s.sortOrder)', 'max')
      .where('s.shopId = :shopId', { shopId })
      .getRawOne<{ max: string | null }>();
    const row = await this.sources.save(
      this.sources.create({
        shopId,
        name: dto.name.trim(),
        includeInDeclared: !!dto.includeInDeclared,
        kind,
        accountId,
        sortOrder: dto.sortOrder ?? Number(maxSort?.max ?? 0) + 1,
        active: dto.active !== false,
      }),
    );
    return this.toDto(row, await this.accountName(shopId, row.accountId));
  }

  async update(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: UpdateShopClosingSourceDto,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.sources.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Fuente no encontrada');
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.includeInDeclared !== undefined) row.includeInDeclared = !!dto.includeInDeclared;
    if (dto.kind !== undefined) row.kind = dto.kind;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) row.active = !!dto.active;
    const kind = dto.kind ?? row.kind;
    if (dto.accountId !== undefined || dto.kind !== undefined) {
      row.accountId = await this.resolveAccount(shopId, kind, dto.accountId ?? row.accountId);
    }
    await this.sources.save(row);
    return this.toDto(row, await this.accountName(shopId, row.accountId));
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.sources.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Fuente no encontrada');
    row.active = false;
    await this.sources.save(row);
    await this.sources.softRemove(row);
    return { ok: true };
  }

  private async resolveAccount(
    shopId: string,
    kind: ClosingSourceKind,
    accountId?: string | null,
  ): Promise<string | null> {
    const needsAccount =
      kind === ClosingSourceKind.OWN_ACCOUNT || kind === ClosingSourceKind.SETTLE_ACCOUNT;
    if (!needsAccount) return accountId?.trim() || null;
    if (!accountId) {
      throw new BadRequestException('Elegí la cuenta destino de esta fuente');
    }
    const acc = await this.accounts.findOne({ where: { id: accountId, shopId } });
    if (!acc || !isEntityActive(acc.active)) {
      throw new BadRequestException('Cuenta destino inválida');
    }
    return acc.id;
  }

  private async accountName(shopId: string, accountId?: string | null): Promise<string | null> {
    if (!accountId) return null;
    const acc = await this.accounts.findOne({
      where: { id: accountId, shopId },
      withDeleted: true,
    });
    return acc?.name ?? null;
  }

  private toDto(r: ShopClosingSource, accountName: string | null = null) {
    return {
      id: r.id,
      shopId: r.shopId,
      name: r.name,
      includeInDeclared: !!r.includeInDeclared,
      kind: r.kind,
      accountId: r.accountId ?? null,
      accountName: accountName ?? r.account?.name ?? null,
      sortOrder: r.sortOrder,
      active: !!r.active,
    };
  }
}
