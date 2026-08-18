import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ClosingSourceAmount } from '../../entities/closing-source-amount.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { MovementsService } from '../movements/movements.service';
import { AuthUser } from '../../common/decorators';
import { ClosingSourceKind, ConceptKind, LedgerAccountType } from '../../common/enums';
import { SettleClosingSourcesDto } from './dto/settlement.dto';

const n = (v?: number | string | null) => Number(v ?? 0);

const SETTLE_KINDS = [ClosingSourceKind.SETTLE_CASH, ClosingSourceKind.SETTLE_ACCOUNT];

function sourceLinesOf(raw?: unknown): number[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map((v) => n(v)).filter((v) => v > 0);
}

function actorDisplayName(user: AuthUser): string {
  return String(user.fullName || user.email || '').trim() || 'Usuario';
}

@Injectable()
export class SettlementsService implements OnModuleInit {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    @InjectRepository(ClosingSourceAmount)
    private readonly sourceAmounts: Repository<ClosingSourceAmount>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept)
    private readonly concepts: Repository<Concept>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
    private readonly movements: MovementsService,
  ) {}

  async onModuleInit() {
    for (const sql of [
      `ALTER TABLE closing_source_amounts ADD COLUMN settledAt DATETIME(6) NULL`,
      `ALTER TABLE closing_source_amounts ADD COLUMN settledToAccountId VARCHAR(36) NULL`,
      `ALTER TABLE closing_source_amounts ADD COLUMN settledByUserId VARCHAR(36) NULL`,
      `ALTER TABLE closing_source_amounts ADD COLUMN settledByName VARCHAR(200) NULL`,
      `ALTER TABLE closing_source_amounts ADD COLUMN settlementMovementId VARCHAR(36) NULL`,
      `ALTER TABLE closing_source_amounts ADD COLUMN settleBatchId VARCHAR(36) NULL`,
    ]) {
      try {
        await this.sourceAmounts.query(sql);
      } catch {
        // ya existe
      }
    }
    try {
      await this.sourceAmounts.query(
        `CREATE INDEX IDX_closing_source_amounts_settle_batch ON closing_source_amounts (settleBatchId)`,
      );
    } catch {
      // ya existe
    }
  }

  async listPending(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.sourceAmounts
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.closing', 'c')
      .where('c.shopId = :shopId', { shopId })
      .andWhere('c.active = true')
      .andWhere('s.kind IN (:...kinds)', { kinds: SETTLE_KINDS })
      .andWhere('s.settledAt IS NULL')
      .andWhere('s.amount > 0')
      .orderBy('s.name', 'ASC')
      .addOrderBy('c.businessDate', 'DESC')
      .getMany();

    return rows.map((r) => this.toPendingDto(r));
  }

  async listHistory(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.sourceAmounts
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.closing', 'c')
      .leftJoinAndSelect('s.settledToAccount', 'acc')
      .where('c.shopId = :shopId', { shopId })
      .andWhere('c.active = true')
      .andWhere('s.settledAt IS NOT NULL')
      .orderBy('s.settledAt', 'DESC')
      .addOrderBy('c.businessDate', 'DESC')
      .take(400)
      .getMany();

    type Group = {
      id: string;
      settledAt: string;
      settledByUserId: string | null;
      settledByName: string;
      accountId: string | null;
      accountName: string | null;
      movementId: string | null;
      totalAmount: number;
      itemsCount: number;
      items: Array<{
        id: string;
        closingId: string;
        businessDate: string;
        name: string;
        kind: ClosingSourceKind;
        amount: number;
        lines: number[];
      }>;
    };

    const groups = new Map<string, Group>();
    for (const r of rows) {
      const settledAtIso = r.settledAt ? new Date(r.settledAt).toISOString() : '';
      const key =
        r.settleBatchId ||
        [settledAtIso, r.settledByUserId ?? '', r.settledToAccountId ?? ''].join('|');
      const item = {
        id: r.id,
        closingId: r.closingId,
        businessDate: r.closing?.businessDate ?? '',
        name: r.name,
        kind: r.kind,
        amount: n(r.amount),
        lines: sourceLinesOf(r.lines),
      };
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
        existing.totalAmount += item.amount;
        existing.itemsCount += 1;
        continue;
      }
      groups.set(key, {
        id: r.settleBatchId || r.id,
        settledAt: settledAtIso,
        settledByUserId: r.settledByUserId ?? null,
        settledByName: r.settledByName?.trim() || 'Sin asignar',
        accountId: r.settledToAccountId ?? null,
        accountName: r.settledToAccount?.name ?? null,
        movementId: r.settlementMovementId ?? null,
        totalAmount: item.amount,
        itemsCount: 1,
        items: [item],
      });
    }

    return [...groups.values()].map((g) => ({
      ...g,
      items: g.items.sort((a, b) => {
        const byName = a.name.localeCompare(b.name, 'es');
        if (byName) return byName;
        return String(b.businessDate).localeCompare(String(a.businessDate));
      }),
    }));
  }

  async settle(user: AuthUser, shopId: string, dto: SettleClosingSourcesDto) {
    this.shops.assertShopAccess(user, shopId);
    const ids = [...new Set(dto.ids)];
    const rows = await this.sourceAmounts
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.closing', 'c')
      .where('s.id IN (:...ids)', { ids })
      .andWhere('c.shopId = :shopId', { shopId })
      .andWhere('c.active = true')
      .andWhere('s.kind IN (:...kinds)', { kinds: SETTLE_KINDS })
      .andWhere('s.settledAt IS NULL')
      .andWhere('s.amount > 0')
      .getMany();

    if (rows.length !== ids.length) {
      throw new NotFoundException(
        'Una o más rendiciones no existen, ya se rindieron o no corresponden a este local',
      );
    }

    await this.catalogSeed.ensureShopCatalogs(shopId);

    const dest = await this.accounts.findOne({
      where: { id: dto.accountId, shopId, active: true },
    });
    if (!dest) throw new BadRequestException('Cuenta destino no encontrada');
    if (dest.type === LedgerAccountType.SYSTEM) {
      throw new BadRequestException('Elegí una cuenta del local, no Ingreso/Egreso');
    }

    const ingreso = await this.accounts.findOne({
      where: { shopId, code: 'INGRESO', active: true },
    });
    if (!ingreso) throw new BadRequestException('Falta la cuenta de Ingreso del local');

    const total = rows.reduce((sum, r) => sum + n(r.amount), 0);
    if (total <= 0) throw new BadRequestException('El monto a rendir es 0');

    const concept = await this.concepts.findOne({
      where: { shopId, name: 'Cobro', kind: ConceptKind.INCOME, active: true },
    });
    const fallback = concept
      ? null
      : await this.concepts.findOne({
          where: { shopId, name: 'Ingreso', kind: ConceptKind.INCOME, active: true },
        });

    const names = [...new Set(rows.map((r) => r.name.trim() || 'Cuenta'))];
    const nameSummary = names
      .map((name) => {
        const count = rows.filter((r) => (r.name.trim() || 'Cuenta') === name).length;
        return count > 1 ? `${name} (${count})` : name;
      })
      .join(', ');

    const today = new Date();
    const businessDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const movement = await this.movements.create(user, shopId, {
      businessDate,
      fromAccountId: ingreso.id,
      toAccountId: dest.id,
      description: `Rendición · ${nameSummary}`,
      amountUyu: total,
      conceptId: concept?.id ?? fallback?.id ?? null,
    });

    const now = new Date();
    const settleBatchId = randomUUID();
    const settledByName = actorDisplayName(user);
    for (const row of rows) {
      row.settledAt = now;
      row.settledToAccountId = dest.id;
      row.settledByUserId = user.id;
      row.settledByName = settledByName;
      row.settlementMovementId = movement.id;
      row.settleBatchId = settleBatchId;
      await this.sourceAmounts.save(row);
    }

    this.logger.log(
      `Rendición ${settleBatchId}: ${rows.length} montos → ${dest.name} ($${total.toFixed(2)})`,
    );

    return {
      ok: true,
      settled: rows.length,
      settleBatchId,
      movementId: movement.id,
      totalAmount: total,
    };
  }

  private toPendingDto(r: ClosingSourceAmount) {
    return {
      id: r.id,
      closingId: r.closingId,
      businessDate: r.closing?.businessDate ?? '',
      sourceId: r.sourceId ?? null,
      name: r.name,
      kind: r.kind,
      amount: n(r.amount),
      lines: sourceLinesOf(r.lines),
    };
  }
}
