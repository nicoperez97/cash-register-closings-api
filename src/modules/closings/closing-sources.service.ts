import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { AuthUser } from '../../common/decorators';
import {
  ClosingSourceKind,
  ClosingSourceRole,
  LinkedPaymentMethod,
} from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { PosnetType, SourcePosnet } from '../../common/posnet';
import { findCashDrawerAccount } from '../../common/catalog-seed';
import {
  UpdateShopClosingSourceDto,
  UpsertShopClosingSourceDto,
} from './dto/closing-source.dto';

const SETTLE_KINDS = new Set<ClosingSourceKind>([
  ClosingSourceKind.SETTLE_CASH,
  ClosingSourceKind.SETTLE_ACCOUNT,
]);

/** Cuentas del local por defecto (nombre canónico + cómo matchear legacy). */
const DEFAULT_STANDARD_SOURCES: Array<{
  name: string;
  aliases: string[];
  accountCodes: string[];
  linkedMethod: LinkedPaymentMethod;
  posnetType: PosnetType;
  sortOrder: number;
}> = [
  {
    name: 'PVS',
    aliases: ['pvs', 'tarjeta', 'pvs / tarjeta', 'card'],
    accountCodes: ['PVS'],
    linkedMethod: LinkedPaymentMethod.CARD,
    posnetType: PosnetType.PVS,
    sortOrder: 10,
  },
  {
    name: 'Mercado Pago',
    aliases: ['mercado pago', 'mp', 'mercadopago'],
    accountCodes: ['MP'],
    linkedMethod: LinkedPaymentMethod.MERCADO_PAGO,
    posnetType: PosnetType.MERCADO_PAGO,
    sortOrder: 20,
  },
  {
    name: 'Cuenta DNI',
    aliases: ['cuenta dni', 'dni'],
    accountCodes: ['DNI'],
    linkedMethod: LinkedPaymentMethod.ACCOUNT_DNI,
    posnetType: PosnetType.CUENTA_DNI,
    sortOrder: 30,
  },
];

function normalizeLagDays(raw: unknown, kind: ClosingSourceKind): number {
  if (!SETTLE_KINDS.has(kind)) return 0;
  const n = Math.round(Number(raw ?? 0));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(90, n);
}

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizePosnets(raw: unknown): SourcePosnet[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException('posnets inválido');
  }
  const out: SourcePosnet[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const name = String((row as SourcePosnet).name ?? '').trim();
    if (!name) continue;
    const id = String((row as SourcePosnet).id ?? '').trim() || randomUUID();
    out.push({ id, name });
  }
  return out;
}

function parsePosnetsColumn(raw: unknown): SourcePosnet[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  try {
    return normalizePosnets(value);
  } catch {
    return [];
  }
}

@Injectable()
export class ClosingSourcesService implements OnModuleInit {
  constructor(
    @InjectRepository(ShopClosingSource)
    private readonly sources: Repository<ShopClosingSource>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Shop)
    private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    for (const sql of [
      `ALTER TABLE shop_closing_sources ADD COLUMN role ENUM('STANDARD','CASH') NOT NULL DEFAULT 'STANDARD'`,
      `ALTER TABLE shop_closing_sources ADD COLUMN posnets JSON NULL`,
      `ALTER TABLE closing_source_amounts ADD COLUMN role ENUM('STANDARD','CASH') NOT NULL DEFAULT 'STANDARD'`,
      `ALTER TABLE closing_source_amounts ADD COLUMN posnetAmounts JSON NULL`,
      `ALTER TABLE shop_closing_sources ADD COLUMN settlementLagDays INT NOT NULL DEFAULT 0`,
    ]) {
      try {
        await this.sources.query(sql);
      } catch {
        /* already exists */
      }
    }
  }

  async list(user: AuthUser, shopId: string, activeOnly = false) {
    this.shops.assertShopAccess(user, shopId);
    await this.ensureDefaults(shopId);
    const where = activeOnly ? { shopId, active: true } : { shopId };
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
        includeInDeclared: dto.includeInDeclared !== false,
        kind,
        role: ClosingSourceRole.STANDARD,
        accountId,
        posnets: normalizePosnets(dto.posnets),
        settlementLagDays: normalizeLagDays(dto.settlementLagDays, kind),
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
    if (!row) throw new NotFoundException('Cuenta del local no encontrada');
    const isCash = row.role === ClosingSourceRole.CASH;
    if (isCash) {
      if (dto.name !== undefined && normName(dto.name) !== 'efectivo') {
        throw new BadRequestException('No se puede renombrar la cuenta Efectivo');
      }
      if (dto.kind !== undefined && dto.kind !== ClosingSourceKind.OWN_ACCOUNT) {
        throw new BadRequestException('Efectivo siempre deposita en cuenta del local');
      }
      if (dto.posnets !== undefined && normalizePosnets(dto.posnets).length) {
        throw new BadRequestException('Efectivo no tiene posnets');
      }
      if (dto.active === false) {
        throw new BadRequestException('No se puede desactivar Efectivo');
      }
    } else if (dto.name !== undefined) {
      row.name = dto.name.trim();
    }
    if (dto.includeInDeclared !== undefined && !isCash) {
      row.includeInDeclared = !!dto.includeInDeclared;
    }
    if (dto.kind !== undefined && !isCash) row.kind = dto.kind;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.active !== undefined && !isCash) row.active = !!dto.active;
    if (dto.posnets !== undefined && !isCash) {
      row.posnets = normalizePosnets(dto.posnets);
    }
    const kind = dto.kind ?? row.kind;
    if (dto.accountId !== undefined || dto.kind !== undefined) {
      row.accountId = await this.resolveAccount(shopId, kind, dto.accountId ?? row.accountId);
    }
    if (dto.settlementLagDays !== undefined || dto.kind !== undefined) {
      row.settlementLagDays = normalizeLagDays(
        dto.settlementLagDays !== undefined ? dto.settlementLagDays : row.settlementLagDays,
        kind,
      );
    }
    await this.sources.save(row);
    return this.toDto(row, await this.accountName(shopId, row.accountId));
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.sources.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cuenta del local no encontrada');
    if (row.role === ClosingSourceRole.CASH) {
      throw new BadRequestException('No se puede eliminar la cuenta Efectivo');
    }
    row.active = false;
    await this.sources.save(row);
    await this.sources.softRemove(row);
    return { ok: true };
  }

  /**
   * Asegura Efectivo + PVS/MP/DNI, migra posnets legacy de shops.posnets
   * y resuelve cuenta destino desde linkedPaymentMethod / código de canal.
   */
  async ensureDefaults(shopId: string): Promise<void> {
    const accounts = await this.accounts.find({ where: { shopId } });
    const existing = await this.sources.find({ where: { shopId } });
    const byNorm = new Map(existing.map((s) => [normName(s.name), s]));

    const findAccount = (
      linked: LinkedPaymentMethod,
      codes: string[],
    ): LedgerAccount | null => {
      const byLink = accounts.find(
        (a) => a.active && a.linkedPaymentMethod === linked,
      );
      if (byLink) return byLink;
      for (const code of codes) {
        const hit = accounts.find((a) => a.active && a.code === code);
        if (hit) return hit;
      }
      return null;
    };

    let cash = existing.find((s) => s.role === ClosingSourceRole.CASH);
    if (!cash) {
      const cashAcc =
        findAccount(LinkedPaymentMethod.CASH, ['EFECTIVO']) ??
        findCashDrawerAccount(accounts);
      cash = await this.sources.save(
        this.sources.create({
          shopId,
          name: 'Efectivo',
          includeInDeclared: true,
          kind: ClosingSourceKind.OWN_ACCOUNT,
          role: ClosingSourceRole.CASH,
          accountId: cashAcc?.id ?? null,
          posnets: [],
          settlementLagDays: 0,
          sortOrder: 0,
          active: true,
        }),
      );
      byNorm.set('efectivo', cash);
    } else if (!cash.accountId) {
      const cashAcc =
        findAccount(LinkedPaymentMethod.CASH, ['EFECTIVO']) ??
        findCashDrawerAccount(accounts);
      if (cashAcc) {
        cash.accountId = cashAcc.id;
        cash.kind = ClosingSourceKind.OWN_ACCOUNT;
        cash.includeInDeclared = true;
        await this.sources.save(cash);
      }
    }

    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const legacyPosnets = Array.isArray(shop?.posnets) ? shop!.posnets! : [];
    const posnetsByType = new Map<string, SourcePosnet[]>();
    for (const p of legacyPosnets) {
      const type = String(p.type ?? '');
      const list = posnetsByType.get(type) ?? [];
      list.push({
        id: String(p.id || randomUUID()),
        name: String(p.name ?? '').trim() || 'Posnet',
      });
      posnetsByType.set(type, list);
    }

    for (const def of DEFAULT_STANDARD_SOURCES) {
      let row =
        byNorm.get(normName(def.name)) ??
        existing.find((s) => def.aliases.includes(normName(s.name)));
      const account = findAccount(def.linkedMethod, def.accountCodes);
      const migrated = posnetsByType.get(def.posnetType) ?? [];
      if (!row) {
        row = await this.sources.save(
          this.sources.create({
            shopId,
            name: def.name,
            includeInDeclared: true,
            kind: ClosingSourceKind.OWN_ACCOUNT,
            role: ClosingSourceRole.STANDARD,
            accountId: account?.id ?? null,
            posnets: migrated,
            settlementLagDays: 0,
            sortOrder: def.sortOrder,
            active: true,
          }),
        );
      } else {
        let dirty = false;
        if (!row.accountId && account) {
          row.accountId = account.id;
          row.kind = ClosingSourceKind.OWN_ACCOUNT;
          dirty = true;
        }
        const current = parsePosnetsColumn(row.posnets);
        if (!current.length && migrated.length) {
          row.posnets = migrated;
          dirty = true;
        }
        if (dirty) await this.sources.save(row);
      }
    }

    // Vaciar posnets top-level solo cuando cada tipo legacy ya quedó en su cuenta.
    if (legacyPosnets.length && shop) {
      const refreshed = await this.sources.find({ where: { shopId } });
      const byNormFresh = new Map(refreshed.map((s) => [normName(s.name), s]));
      const fullyMigrated = DEFAULT_STANDARD_SOURCES.every((def) => {
        const need = posnetsByType.get(def.posnetType) ?? [];
        if (!need.length) return true;
        const row =
          byNormFresh.get(normName(def.name)) ??
          refreshed.find((s) => def.aliases.includes(normName(s.name)));
        return !!row && parsePosnetsColumn(row.posnets).length > 0;
      });
      if (fullyMigrated) {
        shop.posnets = [];
        await this.shopsRepo.save(shop);
      }
    }
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
      throw new BadRequestException('Elegí la cuenta destino de esta cuenta del local');
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
      role: r.role ?? ClosingSourceRole.STANDARD,
      accountId: r.accountId ?? null,
      accountName: accountName ?? r.account?.name ?? null,
      posnets: parsePosnetsColumn(r.posnets),
      settlementLagDays: Number(r.settlementLagDays ?? 0) || 0,
      sortOrder: r.sortOrder,
      active: !!r.active,
    };
  }
}
