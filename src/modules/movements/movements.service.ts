import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import {
  ConceptKind,
  GlobalRole,
  LedgerAccountType,
  NotificationType,
  Permission,
} from '../../common/enums';
import { isGlobalAdmin, resolveUserPermissions } from '../../common/guards';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as ExcelJS from 'exceljs';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

function formatArMoney(value: number): string {
  const num = Number(value ?? 0);
  const abs = Math.abs(num).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `- $${abs}` : `$${abs}`;
}

export type MovementKindFilter = 'expense' | 'transfer';

export interface MovementFilters {
  from?: string;
  to?: string;
  fromAccountId?: string;
  toAccountId?: string;
  conceptId?: string;
  closingId?: string;
  q?: string;
  kind?: MovementKindFilter;
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
  notifyAdmins?: boolean;
  /** expense = gasto con concepto; transfer = entre cuentas sin concepto */
  kind?: MovementKindFilter;
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
    private readonly notifications: NotificationsService,
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

  private assertPerm(user: AuthUser, shopId: string, ...need: Permission[]) {
    const perms = resolveUserPermissions(user, shopId);
    if (!need.every((p) => perms.includes(p))) {
      throw new ForbiddenException('Sin permiso');
    }
  }

  private assertAnyPerm(user: AuthUser, shopId: string, ...need: Permission[]) {
    const perms = resolveUserPermissions(user, shopId);
    if (!need.some((p) => perms.includes(p))) {
      throw new ForbiddenException('Sin permiso');
    }
  }

  private isExpenseRow(r: {
    conceptKind?: string | null;
    toAccountName?: string | null;
    toAccountCode?: string | null;
  }): boolean {
    if (r.conceptKind === ConceptKind.EXPENSE || r.conceptKind === 'EXPENSE') return true;
    const name = (r.toAccountName ?? '').toLowerCase();
    const code = (r.toAccountCode ?? '').toUpperCase();
    return code === 'EGRESO' || name.includes('egreso');
  }

  async list(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    if (filters.kind === 'expense') {
      this.assertPerm(user, shopId, 'expenses.read');
    } else if (filters.kind === 'transfer') {
      this.assertPerm(user, shopId, 'accountTransfers.read');
    } else {
      this.assertAnyPerm(user, shopId, 'expenses.read', 'accountTransfers.read', 'movements.read');
    }

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

    if (filters.kind === 'expense') {
      qb.andWhere(
        `(concept.kind = :expenseKind OR LOWER(toAccount.name) LIKE :egresoName OR UPPER(toAccount.code) = :egresoCode)`,
        { expenseKind: ConceptKind.EXPENSE, egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
    } else if (filters.kind === 'transfer') {
      qb.andWhere(
        `(concept.kind IS NULL OR concept.kind <> :expenseKind) AND (toAccount.id IS NULL OR (LOWER(toAccount.name) NOT LIKE :egresoName AND UPPER(COALESCE(toAccount.code, '')) <> :egresoCode))`,
        { expenseKind: ConceptKind.EXPENSE, egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
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
      const from = await this.accounts.findOne({ where: { id: fromId, shopId } });
      if (!from || !isEntityActive(from.active)) {
        throw new BadRequestException('Cuenta origen inválida');
      }
    }
    if (toId) {
      const to = await this.accounts.findOne({ where: { id: toId, shopId } });
      if (!to || !isEntityActive(to.active)) {
        throw new BadRequestException('Cuenta destino inválida');
      }
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
    const kind = dto.kind;
    if (kind === 'expense') {
      this.assertPerm(user, shopId, 'expenses.manage');
    } else if (kind === 'transfer') {
      this.assertPerm(user, shopId, 'accountTransfers.manage');
    } else {
      this.assertAnyPerm(user, shopId, 'expenses.manage', 'accountTransfers.manage', 'movements.manage');
    }

    let conceptId = dto.conceptId ?? null;
    const fromAccountId = this.normalizeAccountId(dto.fromAccountId);
    const toAccountId = this.normalizeAccountId(dto.toAccountId);
    const fromUserId = this.normalizeUserId(dto.fromUserId);
    const toUserId = this.normalizeUserId(dto.toUserId);

    if (kind === 'transfer') {
      conceptId = null;
      if (!fromAccountId || !toAccountId) {
        throw new BadRequestException('La transferencia requiere cuenta origen y destino');
      }
      if (fromAccountId === toAccountId) {
        throw new BadRequestException('Origen y destino deben ser distintos');
      }
    }
    if (kind === 'expense') {
      if (!conceptId) throw new BadRequestException('El gasto requiere un concepto');
    }

    await this.assertAccounts(shopId, fromAccountId, toAccountId);
    await this.assertShopUser(shopId, fromUserId);
    await this.assertShopUser(shopId, toUserId);
    if (conceptId) {
      const c = await this.concepts.findOne({
        where: { id: conceptId, shopId, active: true },
      });
      if (!c) throw new BadRequestException('Concepto inválido');
      if (kind === 'expense' && c.kind !== ConceptKind.EXPENSE) {
        throw new BadRequestException('El concepto debe ser de tipo egreso');
      }
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
        conceptId,
        invoiced: dto.invoiced ?? false,
        invoiceNumber: dto.invoiceNumber ?? null,
        employeeId: dto.employeeId ?? null,
        closingId: null,
        active: true,
      }),
    );
    const created = await this.one(user, shopId, row.id);
    if (dto.notifyAdmins) {
      void this.notifyAdminsMovementCreated(user, shopId, created).catch(() => undefined);
    }
    return created;
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
    const row = await this.movements.findOne({
      where: { id, shopId },
      relations: ['toAccount', 'concept'],
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    if (row.closingId && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException(
        'Este movimiento fue generado por un cierre; editá el cierre',
      );
    }

    const asExpense = this.isExpenseRow({
      conceptKind: row.concept?.kind,
      toAccountName: row.toAccount?.name,
      toAccountCode: row.toAccount?.code,
    });
    if (asExpense) this.assertPerm(user, shopId, 'expenses.manage');
    else this.assertPerm(user, shopId, 'accountTransfers.manage');

    const kind = dto.kind ?? (asExpense ? 'expense' : 'transfer');

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

    if (kind === 'transfer') {
      row.conceptId = null;
      if (!fromId || !toId) {
        throw new BadRequestException('La transferencia requiere cuenta origen y destino');
      }
    } else if (dto.conceptId !== undefined) {
      if (!dto.conceptId) throw new BadRequestException('El gasto requiere un concepto');
      const c = await this.concepts.findOne({
        where: { id: dto.conceptId, shopId, active: true },
      });
      if (!c) throw new BadRequestException('Concepto inválido');
      row.conceptId = dto.conceptId;
    }

    if (dto.invoiced !== undefined) row.invoiced = dto.invoiced;
    if (dto.invoiceNumber !== undefined) row.invoiceNumber = dto.invoiceNumber;
    if (dto.employeeId !== undefined) row.employeeId = dto.employeeId;

    await this.movements.save(row);
    return this.one(user, shopId, id);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({
      where: { id, shopId },
      relations: ['toAccount', 'concept'],
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    if (row.closingId && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException(
        'Este movimiento fue generado por un cierre; editá el cierre',
      );
    }
    const asExpense = this.isExpenseRow({
      conceptKind: row.concept?.kind,
      toAccountName: row.toAccount?.name,
      toAccountCode: row.toAccount?.code,
    });
    if (asExpense) this.assertPerm(user, shopId, 'expenses.manage');
    else this.assertPerm(user, shopId, 'accountTransfers.manage');
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

  async exportBalancesXlsx(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    const data = await this.balances(user, shopId, filters);
    const accounts = data.accounts ?? [];
    const total = accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';
    wb.created = new Date();
    const ws = wb.addWorksheet('Saldos');
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 18;

    ws.mergeCells('A1:B1');
    const title = ws.getCell('A1');
    title.value = 'SALDOS';
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'left', vertical: 'middle' };
    title.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
    ws.getCell('B1').border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
    ws.getRow(1).height = 22;

    const header = ws.getRow(2);
    header.values = ['Cuenta', 'Saldo'];
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E7E7' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });

    const thin = {
      top: { style: 'thin' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    };

    let rowIdx = 3;
    for (const a of accounts) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = a.name;
      row.getCell(2).value = formatArMoney(a.balance);
      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(2).alignment = { horizontal: 'right' };
      row.getCell(1).border = thin;
      row.getCell(2).border = thin;
      rowIdx += 1;
    }

    const totalRow = ws.getRow(rowIdx);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = formatArMoney(total);
    totalRow.font = { bold: true };
    totalRow.getCell(1).alignment = { horizontal: 'left' };
    totalRow.getCell(2).alignment = { horizontal: 'right' };
    const thickTop = {
      top: { style: 'medium' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    };
    totalRow.getCell(1).border = thickTop;
    totalRow.getCell(2).border = thickTop;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = String(shop?.slug || shopId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      buffer,
      filename: `saldos-${slug || 'local'}-${stamp}.xlsx`,
    };
  }

  private async notifyAdminsMovementCreated(
    actor: AuthUser,
    shopId: string,
    movement: {
      id: string;
      businessDate: string;
      amountUyu: number;
      fromAccountName?: string | null;
      toAccountName?: string | null;
      conceptName?: string | null;
      description?: string | null;
    },
  ) {
    const shop = await this.shops.findOne(actor, shopId);
    const shopName = shop?.name?.trim() || 'Local';
    const links = await this.userShops.find({
      where: {
        shopId,
        shopRole: In([GlobalRole.OWNER, GlobalRole.ADMIN]),
      },
    });
    const recipientIds = new Set(links.map((l) => l.userId));
    const globalOwners = await this.users.find({
      where: { globalRole: GlobalRole.OWNER },
      select: ['id', 'active'],
    });
    for (const u of globalOwners) {
      if (isEntityActive(u.active)) recipientIds.add(u.id);
    }
    recipientIds.delete(actor.id);
    if (!recipientIds.size) return;

    const date = String(movement.businessDate || '').slice(0, 10);
    const amount = formatArMoney(Number(movement.amountUyu || 0));
    const fromName = (movement.fromAccountName ?? '').trim();
    const toName = (movement.toAccountName ?? '').trim();
    const route =
      fromName && toName ? `${fromName} → ${toName}` : fromName || toName || null;
    const title = 'Nuevo movimiento';
    const body = [
      shopName,
      date,
      amount,
      route,
      movement.conceptName?.trim() || null,
      movement.description?.trim() || null,
      `por ${actor.fullName || actor.email}`,
    ]
      .filter(Boolean)
      .join(' · ');

    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.MOVEMENT_CREATED,
        title,
        body,
      })),
    );
  }
}