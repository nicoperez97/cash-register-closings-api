import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole, LedgerAccountType } from '../../common/enums';
import { isGlobalAdmin } from '../../common/guards';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

export interface MovementFilters {
  from?: string;
  to?: string;
  fromAccountId?: string;
  toAccountId?: string;
  conceptId?: string;
  closingId?: string;
  q?: string;
}

export interface UpsertMovementDto {
  businessDate: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  description?: string | null;
  amountUyu: number;
  usdRate?: number | null;
  amountUsd?: number | null;
  conceptId?: string | null;
  invoiced?: boolean;
  invoiceNumber?: string | null;
  employeeId?: string | null;
}

@Injectable()
export class MovementsService implements OnModuleInit {
  constructor(
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async onModuleInit() {
    try {
      await this.movements.query(`
        ALTER TABLE movements
          MODIFY COLUMN fromAccountId VARCHAR(36) NULL,
          MODIFY COLUMN toAccountId VARCHAR(36) NULL
      `);
    } catch {
      // ya aplicado o motor distinto
    }
    for (const sql of [
      `ALTER TABLE movements ADD COLUMN fromUserId CHAR(36) NULL`,
      `ALTER TABLE movements ADD COLUMN toUserId CHAR(36) NULL`,
    ]) {
      try {
        await this.movements.query(sql);
      } catch {
        // ya existe
      }
    }
  }

  private toDto(m: Movement) {
    return {
      id: m.id,
      shopId: m.shopId,
      businessDate: m.businessDate,
      fromAccountId: m.fromAccountId,
      toAccountId: m.toAccountId,
      fromAccountName: m.fromAccount?.name ?? null,
      toAccountName: m.toAccount?.name ?? null,
      fromUserId: m.fromUserId ?? null,
      toUserId: m.toUserId ?? null,
      fromUserName: m.fromUser?.fullName ?? null,
      toUserName: m.toUser?.fullName ?? null,
      description: m.description ?? null,
      amountUyu: n(m.amountUyu),
      usdRate: m.usdRate != null ? n(m.usdRate) : null,
      amountUsd: m.amountUsd != null ? n(m.amountUsd) : null,
      conceptId: m.conceptId ?? null,
      conceptName: m.concept?.name ?? null,
      conceptKind: m.concept?.kind ?? null,
      invoiced: !!m.invoiced,
      invoiceNumber: m.invoiceNumber ?? null,
      closingId: m.closingId ?? null,
      employeeId: m.employeeId ?? null,
      active: !!m.active,
    };
  }

  async list(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);

    const qb = this.movements
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.fromAccount', 'fromAccount')
      .leftJoinAndSelect('m.toAccount', 'toAccount')
      .leftJoinAndSelect('m.fromUser', 'fromUser')
      .leftJoinAndSelect('m.toUser', 'toUser')
      .leftJoinAndSelect('m.concept', 'concept')
      .where('m.shopId = :shopId', { shopId })
      .andWhere('m.active = true');

    if (filters.from) qb.andWhere('m.businessDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('m.businessDate <= :to', { to: filters.to });
    if (filters.fromAccountId) {
      qb.andWhere('m.fromAccountId = :fromAccountId', {
        fromAccountId: filters.fromAccountId,
      });
    }
    if (filters.toAccountId) {
      qb.andWhere('m.toAccountId = :toAccountId', { toAccountId: filters.toAccountId });
    }
    if (filters.conceptId) {
      qb.andWhere('m.conceptId = :conceptId', { conceptId: filters.conceptId });
    }
    if (filters.closingId) {
      qb.andWhere('m.closingId = :closingId', { closingId: filters.closingId });
    }
    if (filters.q?.trim()) {
      qb.andWhere('m.description LIKE :q', { q: `%${filters.q.trim()}%` });
    }

    qb.orderBy('m.businessDate', 'DESC').addOrderBy('m.createdAt', 'DESC');
    const rows = await qb.getMany();
    return rows.map((r) => this.toDto(r));
  }

  private async assertAccounts(
    shopId: string,
    fromId?: string | null,
    toId?: string | null,
  ) {
    if (fromId) {
      const from = await this.accounts.findOne({ where: { id: fromId, shopId, active: true } });
      if (!from) throw new BadRequestException('Cuenta origen inválida');
    }
    if (toId) {
      const to = await this.accounts.findOne({ where: { id: toId, shopId, active: true } });
      if (!to) throw new BadRequestException('Cuenta destino inválida');
    }
  }

  private normalizeAccountId(value?: string | null): string | null {
    const id = value?.trim();
    return id ? id : null;
  }

  private normalizeUserId(value?: string | null): string | null {
    const id = value?.trim();
    if (!id || id === '__local__') return null;
    return id;
  }

  private async assertShopUser(shopId: string, userId: string | null) {
    if (!userId) return;
    const link = await this.userShops.findOne({ where: { shopId, userId } });
    if (!link) throw new BadRequestException('Usuario no pertenece al local');
    const user = await this.users.findOne({ where: { id: userId, active: true } });
    if (!user) throw new BadRequestException('Usuario inválido');
  }

  async create(user: AuthUser, shopId: string, dto: UpsertMovementDto) {
    this.shops.assertShopAccess(user, shopId);
    const fromAccountId = this.normalizeAccountId(dto.fromAccountId);
    const toAccountId = this.normalizeAccountId(dto.toAccountId);
    const fromUserId = this.normalizeUserId(dto.fromUserId);
    const toUserId = this.normalizeUserId(dto.toUserId);
    await this.assertAccounts(shopId, fromAccountId, toAccountId);
    await this.assertShopUser(shopId, fromUserId);
    await this.assertShopUser(shopId, toUserId);
    if (dto.conceptId) {
      const c = await this.concepts.findOne({
        where: { id: dto.conceptId, shopId, active: true },
      });
      if (!c) throw new BadRequestException('Concepto inválido');
    }
    const amountUsd =
      dto.amountUsd != null
        ? dto.amountUsd
        : dto.usdRate && dto.amountUyu
          ? dto.amountUyu / dto.usdRate
          : null;

    const row = await this.movements.save(
      this.movements.create({
        shopId,
        businessDate: dto.businessDate,
        fromAccountId,
        toAccountId,
        fromUserId,
        toUserId,
        description: dto.description?.trim() || null,
        amountUyu: money(n(dto.amountUyu)),
        usdRate: dto.usdRate != null ? String(dto.usdRate) : null,
        amountUsd: amountUsd != null ? String(amountUsd) : null,
        conceptId: dto.conceptId ?? null,
        invoiced: dto.invoiced ?? false,
        invoiceNumber: dto.invoiceNumber ?? null,
        employeeId: dto.employeeId ?? null,
        closingId: null,
        active: true,
      }),
    );
    return this.one(user, shopId, row.id);
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({
      where: { id, shopId },
      relations: ['fromAccount', 'toAccount', 'fromUser', 'toUser', 'concept'],
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    return this.toDto(row);
  }

  async update(user: AuthUser, shopId: string, id: string, dto: Partial<UpsertMovementDto>) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    if (row.closingId && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException(
        'Este movimiento fue generado por un cierre; editá el cierre',
      );
    }

    const fromId =
      dto.fromAccountId !== undefined
        ? this.normalizeAccountId(dto.fromAccountId)
        : row.fromAccountId;
    const toId =
      dto.toAccountId !== undefined
        ? this.normalizeAccountId(dto.toAccountId)
        : row.toAccountId;
    await this.assertAccounts(shopId, fromId, toId);

    if (dto.fromUserId !== undefined) {
      const fromUserId = this.normalizeUserId(dto.fromUserId);
      await this.assertShopUser(shopId, fromUserId);
      row.fromUserId = fromUserId;
    }
    if (dto.toUserId !== undefined) {
      const toUserId = this.normalizeUserId(dto.toUserId);
      await this.assertShopUser(shopId, toUserId);
      row.toUserId = toUserId;
    }

    if (dto.businessDate !== undefined) row.businessDate = dto.businessDate;
    if (dto.fromAccountId !== undefined) row.fromAccountId = fromId;
    if (dto.toAccountId !== undefined) row.toAccountId = toId;
    if (dto.description !== undefined) row.description = dto.description?.trim() || null;
    if (dto.amountUyu !== undefined) row.amountUyu = money(n(dto.amountUyu));
    if (dto.usdRate !== undefined) {
      row.usdRate = dto.usdRate != null ? String(dto.usdRate) : null;
    }
    if (dto.amountUsd !== undefined) {
      row.amountUsd = dto.amountUsd != null ? String(dto.amountUsd) : null;
    } else if (dto.usdRate != null && dto.amountUyu != null) {
      row.amountUsd = String(dto.amountUyu / dto.usdRate);
    }
    if (dto.conceptId !== undefined) row.conceptId = dto.conceptId;
    if (dto.invoiced !== undefined) row.invoiced = dto.invoiced;
    if (dto.invoiceNumber !== undefined) row.invoiceNumber = dto.invoiceNumber;
    if (dto.employeeId !== undefined) row.employeeId = dto.employeeId;

    await this.movements.save(row);
    return this.one(user, shopId, id);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    if (row.closingId && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException(
        'Este movimiento fue generado por un cierre; editá el cierre',
      );
    }
    await this.movements.softRemove(row);
    return { ok: true };
  }

  async expensesByConcept(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.list(user, shopId, filters);
    const expenseRows = rows.filter(
      (r) => r.conceptKind === 'EXPENSE' || r.toAccountName === '2. Egreso',
    );
    const map = new Map<string, { conceptId: string | null; conceptName: string; total: number }>();
    for (const r of expenseRows) {
      const key = r.conceptId ?? r.conceptName ?? 'Sin concepto';
      const cur = map.get(key) ?? {
        conceptId: r.conceptId,
        conceptName: r.conceptName ?? 'Sin concepto',
        total: 0,
      };
      cur.total += r.amountUyu;
      map.set(key, cur);
    }
    const items = [...map.values()].sort((a, b) => b.total - a.total);
    const sum = items.reduce((s, i) => s + i.total, 0);
    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      total: sum,
      items: items.map((i) => ({
        ...i,
        share: sum > 0 ? i.total / sum : 0,
      })),
    };
  }

  async balances(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.list(user, shopId, filters);
    // Socios + canales del local (PVS, MP, efectivo, etc.). Sin SYSTEM (INGRESO/EGRESO).
    const accounts = await this.accounts.find({
      where: [
        { shopId, active: true, type: LedgerAccountType.PARTNER },
        { shopId, active: true, type: LedgerAccountType.CHANNEL },
      ],
      order: { type: 'ASC', name: 'ASC' },
    });
    const bal = new Map<
      string,
      { accountId: string; name: string; type: string; income: number; expense: number }
    >();
    for (const a of accounts) {
      bal.set(a.id, {
        accountId: a.id,
        name: a.name,
        type: a.type,
        income: 0,
        expense: 0,
      });
    }
    for (const r of rows) {
      if (r.fromAccountId) {
        const from = bal.get(r.fromAccountId);
        if (from) from.expense += r.amountUyu;
      }
      if (r.toAccountId) {
        const to = bal.get(r.toAccountId);
        if (to) to.income += r.amountUyu;
      }
    }
    // Canales del local primero, luego socios.
    const ordered = [...bal.values()].sort((a, b) => {
      const rank = (t: string) => (t === LedgerAccountType.CHANNEL ? 0 : 1);
      const d = rank(a.type) - rank(b.type);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, 'es');
    });
    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      accounts: ordered.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        type: a.type,
        income: a.income,
        expense: a.expense,
        balance: a.income - a.expense,
      })),
    };
  }
}
