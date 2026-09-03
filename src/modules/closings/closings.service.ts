import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { ClosingSourceAmount } from '../../entities/closing-source-amount.entity';
import { User } from '../../entities/user.entity';
import { Employee } from '../../entities/employee.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { ClosingMovementsSyncService } from '../movements/closing-movements-sync.service';
import { AccountsService } from '../accounts/accounts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/decorators';
import { assertCanViewClosingsList } from '../../common/guards';
import {
  ClosingStatus,
  ExpenseCategory,
  ExtraLineType,
  GlobalRole,
  NotificationType,
} from '../../common/enums';
import { isGlobalAdmin } from '../../common/guards';
import { isEntityActive } from '../../common/active.util';
import { closingDateKey, markDeletedUnique } from '../../common/soft-delete.util';
import {
  findShopShift,
  normalizeShopShifts,
  resolveCurrentShift,
} from '../../common/shop-shifts';
import { CreateClosingDto, UpdateClosingDto } from './dto/closing.dto';
import { applyClosingFilters, ClosingListFilters } from './closing-filters';
import { ClosingPosnetAmount, sumPosnetsByType } from '../../common/posnet';
import { CashWithdrawalsService } from './cash-withdrawals.service';
import { TipsService } from '../tips/tips.service';

const n = (v?: number | string | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

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

function sourceAmountOf(row: { amount?: number | string | null; lines?: unknown }): number {
  const lines = sourceLinesOf(row.lines);
  return lines.length ? lines.reduce((sum, v) => sum + v, 0) : n(row.amount);
}

const SHOP_ADMIN_ROLES = new Set<GlobalRole>([GlobalRole.OWNER, GlobalRole.ADMIN]);

@Injectable()
export class ClosingsService implements OnModuleInit {
  private readonly logger = new Logger(ClosingsService.name);

  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(ClosingExpense) private readonly expenses: Repository<ClosingExpense>,
    @InjectRepository(ClosingExtraLine) private readonly extras: Repository<ClosingExtraLine>,
    @InjectRepository(ShopClosingSource) private readonly sources: Repository<ShopClosingSource>,
    @InjectRepository(ClosingSourceAmount)
    private readonly sourceAmounts: Repository<ClosingSourceAmount>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(Shop) private readonly shopRepo: Repository<Shop>,
    private readonly shops: ShopsService,
    private readonly closingMovements: ClosingMovementsSyncService,
    private readonly accounts: AccountsService,
    private readonly notifications: NotificationsService,
    private readonly cashWithdrawals: CashWithdrawalsService,
    private readonly tips: TipsService,
  ) {}

  async onModuleInit() {
    try {
      await this.closings.query(`
        UPDATE cash_closings
        SET businessDateKey = DATE_FORMAT(businessDate, '%Y-%m-%d')
        WHERE businessDateKey IS NULL OR businessDateKey = ''
      `);
    } catch (err) {
      this.logger.warn(`No se pudo backfill businessDateKey: ${(err as Error)?.message}`);
    }
    try {
      await this.closings.query(`
        ALTER TABLE cash_closings
          ADD COLUMN shiftId VARCHAR(36) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.closings.query(`
        ALTER TABLE cash_closings
          ADD COLUMN shiftName VARCHAR(80) NULL
      `);
    } catch {
      // columna ya existe
    }
    await this.backfillClosingShifts();
    try {
      await this.closings.query(`
        ALTER TABLE cash_closings
          ADD COLUMN cashWithdrawnToAccountId VARCHAR(36) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.closings.query(`
        ALTER TABLE cash_closings
          ADD COLUMN cashOpeningAmount DECIMAL(12,2) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    // Una sola vez: volver al signo caja sistema − declarado (v3).
    try {
      await this.closings.query(`
        CREATE TABLE IF NOT EXISTS app_meta (
          metaKey VARCHAR(64) NOT NULL PRIMARY KEY,
          metaValue VARCHAR(255) NULL,
          updatedAt DATETIME(6) NULL
        )
      `);
      const rows: Array<{ c: number | string }> = await this.closings.query(
        `SELECT COUNT(*) AS c FROM app_meta WHERE metaKey = 'difference_formula_v3'`,
      );
      const already = Number(rows?.[0]?.c ?? 0) > 0;
      if (!already) {
        await this.closings.query(`
          INSERT INTO app_meta (metaKey, metaValue, updatedAt)
          VALUES ('difference_formula_v3', '1', NOW(6))
        `);
        await this.closings.query(`UPDATE cash_closings SET difference = -difference`);
        this.logger.log('Migradas diferencias de cierre al signo caja sistema − declarado');
      }
    } catch (err) {
      this.logger.warn(`No se pudo migrar signo de diferencia v3: ${(err as Error)?.message}`);
    }
    try {
      await this.closings.query(`
        ALTER TABLE closing_expenses
          ADD COLUMN conceptId VARCHAR(36) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.closings.query(`
        ALTER TABLE closing_expenses
          ADD COLUMN notes VARCHAR(400) NULL
      `);
    } catch {
      // columna ya existe
    }
  }

  private async resolveWithdrawnBy(
    shopId: string,
    userId?: string | null,
    name?: string | null,
    employeeId?: string | null,
  ) {
    if (employeeId) {
      const emp = await this.employees.findOne({ where: { id: employeeId, shopId, active: true } });
      if (emp) {
        return {
          cashWithdrawnByEmployeeId: emp.id,
          cashWithdrawnByUserId: emp.userId ?? null,
          cashWithdrawnByName: emp.fullName,
        };
      }
    }
    if (userId) {
      const u = await this.users.findOne({ where: { id: userId, active: true } });
      if (u) {
        return {
          cashWithdrawnByUserId: u.id,
          cashWithdrawnByName: u.fullName,
          cashWithdrawnByEmployeeId: null as string | null,
        };
      }
    }
    return {
      cashWithdrawnByUserId: userId ?? null,
      cashWithdrawnByName: name?.trim() || null,
      cashWithdrawnByEmployeeId: null as string | null,
    };
  }

  /**
   * Destino del efectivo: cuenta PARTNER de quien se lo lleva
   * (crea si no tiene; exige elección si tiene varias).
   */
  private async resolveWithdrawnToAccount(
    shopId: string,
    cashWithdrawn: number,
    cashAmount: number,
    userId?: string | null,
    preferredAccountId?: string | null,
  ): Promise<string | null> {
    if (!userId) return preferredAccountId ?? null;
    if (!(cashWithdrawn > 0) && !(cashAmount > 0)) return preferredAccountId ?? null;
    const account = await this.accounts.resolvePartnerAccountForUser(
      shopId,
      userId,
      preferredAccountId,
    );
    return account.id;
  }

  private calc(dto: Partial<CreateClosingDto>, extraIncome = 0) {
    const calculated =
      n(dto.cardAmount) + n(dto.cashAmount) + n(dto.mercadoPagoAmount) +
      n(dto.deliveryAppsAmount) + n(dto.transferAmount) + n(dto.accountDniAmount) +
      n(dto.otherAmount) + extraIncome;
    const declared = dto.declaredTotal !== undefined ? n(dto.declaredTotal) : calculated;
    return { calculatedTotal: calculated, declaredTotal: declared, difference: n(dto.posSystemAmount) - declared };
  }

  /**
   * Si hay montos por posnet, sobrescribe solo los canales presentes en el listado.
   * Así, sin posnets PVS/MP/DNI (o sin transferencias DNI en el snapshot) no se pisan
   * los montos cargados a mano.
   */
  private applyPosnetSums(dto: Partial<CreateClosingDto>): Partial<CreateClosingDto> {
    if (dto.posnetAmounts === undefined) return dto;
    if (dto.posnetAmounts === null || dto.posnetAmounts.length === 0) {
      return { ...dto, posnetAmounts: dto.posnetAmounts ?? [] };
    }
    const rows = dto.posnetAmounts as ClosingPosnetAmount[];
    const sums = sumPosnetsByType(rows);
    const hasType = (type: string) => rows.some((r) => r.type === type);
    return {
      ...dto,
      ...(hasType('PVS') ? { cardAmount: sums.cardAmount } : {}),
      ...(hasType('MERCADO_PAGO') ? { mercadoPagoAmount: sums.mercadoPagoAmount } : {}),
      ...(hasType('CUENTA_DNI') ? { accountDniAmount: sums.accountDniAmount } : {}),
    };
  }

  private normalizePosnetAmounts(
    raw?: CreateClosingDto['posnetAmounts'] | ClosingPosnetAmount[] | null,
  ): ClosingPosnetAmount[] | null {
    if (raw == null) return null;
    return raw.map((row) => ({
      posnetId: String(row.posnetId),
      name: String(row.name ?? '').trim() || 'Posnet',
      type: row.type,
      amount: n(row.amount),
    }));
  }

  private async backfillClosingShifts() {
    const shops = await this.shopRepo.find();
    for (const shop of shops) {
      const shifts = normalizeShopShifts(shop.shifts, shop.openingTime);
      const shift = shifts[0];
      if (!shift) continue;
      await this.closings.query(
        `
        UPDATE cash_closings
        SET shiftId = ?, shiftName = ?,
            businessDateKey = CONCAT(DATE_FORMAT(businessDate, '%Y-%m-%d'), '__', ?)
        WHERE shopId = ?
          AND active = 1
          AND (shiftId IS NULL OR shiftId = '' OR businessDateKey NOT LIKE '%\\_\\_%')
        `,
        [shift.id, shift.name, shift.id, shop.id],
      );
    }
  }

  private async resolveClosingShift(shopId: string, shiftId?: string | null) {
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop) throw new NotFoundException('Local no encontrado');
    const shifts = normalizeShopShifts(shop.shifts, shop.openingTime);
    const shift = shiftId
      ? findShopShift(shifts, shiftId)
      : resolveCurrentShift(shifts, new Date(), shop.timezone);
    if (!shift || (shiftId && shift.id !== shiftId)) {
      throw new BadRequestException('Turno inválido para este local');
    }
    return shift;
  }

  private toDto(c: CashClosing, extras?: { expensesTotal?: number }) {
    return {
      id: c.id, shopId: c.shopId, businessDate: c.businessDate,
      shiftId: c.shiftId ?? null,
      shiftName: c.shiftName ?? null,
      posSystemAmount: n(c.posSystemAmount), cardAmount: n(c.cardAmount), cashAmount: n(c.cashAmount),
      mercadoPagoAmount: n(c.mercadoPagoAmount), deliveryAppsAmount: n(c.deliveryAppsAmount),
      transferAmount: n(c.transferAmount), accountDniAmount: n(c.accountDniAmount), otherAmount: n(c.otherAmount),
      posnetAmounts: (c.posnetAmounts ?? []).map((p) => ({
        posnetId: p.posnetId,
        name: p.name,
        type: p.type,
        amount: n(p.amount),
      })),
      unitsSold: c.unitsSold, coversCount: c.coversCount,
      averageTicket: c.averageTicket != null ? n(c.averageTicket) : null,
      cashOpeningAmount: n(c.cashOpeningAmount),
      cashLeftInRegister: n(c.cashLeftInRegister), cashPendingPickup: n(c.cashPendingPickup),
      cashWithdrawn: n(c.cashWithdrawn), cashWithdrawnByUserId: c.cashWithdrawnByUserId,
      cashWithdrawnByEmployeeId: c.cashWithdrawnByEmployeeId ?? null, cashWithdrawnByName: c.cashWithdrawnByName,
      cashWithdrawnToAccountId: c.cashWithdrawnToAccountId ?? null,
      tipsAmount: n(c.tipsAmount), declaredTotal: n(c.declaredTotal), calculatedTotal: n(c.calculatedTotal),
      difference: n(c.difference), differenceReason: c.differenceReason, notes: c.notes,
      evidenceUrl: c.evidenceUrl, status: c.status, createdByUserId: c.createdByUserId, submittedAt: c.submittedAt,
      expenses: (c.expenses ?? []).map((e) => ({
        id: e.id,
        label: e.label,
        amount: n(e.amount),
        category: e.category,
        conceptId: e.conceptId ?? null,
        notes: e.notes ?? null,
      })),
      expensesTotal:
        extras?.expensesTotal ?? (c.expenses ?? []).reduce((s, e) => s + n(e.amount), 0),
      extraLines: (c.extraLines ?? []).map((e) => ({ id: e.id, type: e.type, label: e.label, amount: n(e.amount), meta: e.meta })),
      sourceAmounts: (c.sourceAmounts ?? []).map((s) => ({
        id: s.id,
        sourceId: s.sourceId,
        name: s.name,
        includeInDeclared: !!s.includeInDeclared,
        kind: s.kind,
        accountId: s.accountId ?? null,
        amount: n(s.amount),
        lines: sourceLinesOf(s.lines),
      })),
    };
  }

  private async syncMovements(closingId: string) {
    const full = await this.closings.findOne({
      where: { id: closingId },
      relations: ['expenses', 'extraLines', 'sourceAmounts'],
    });
    if (!full) return;
    await this.closingMovements.syncFromClosing(full);
    await this.cashWithdrawals.syncFromClosing(full);
  }

  private async declaredFromSources(shopId: string, dto: Partial<CreateClosingDto>): Promise<number> {
    const rows = dto.sourceAmounts ?? [];
    if (!rows.length) return 0;
    const sources = await this.sources.find({ where: { shopId } });
    const byId = new Map(sources.map((s) => [s.id, s]));
    let extra = 0;
    for (const row of rows) {
      const src = byId.get(row.sourceId);
      if (src?.includeInDeclared) extra += sourceAmountOf(row);
    }
    return extra;
  }

  async list(user: AuthUser, shopId: string, filters: ClosingListFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    assertCanViewClosingsList(user, shopId);
    const rows = await this.queryFiltered(shopId, filters, false);
    const ids = rows.map((r) => r.id);
    const totals = new Map<string, number>();
    if (ids.length) {
      const raw = await this.expenses
        .createQueryBuilder('e')
        .select('e.closingId', 'closingId')
        .addSelect('COALESCE(SUM(e.amount), 0)', 'total')
        .where('e.closingId IN (:...ids)', { ids })
        .groupBy('e.closingId')
        .getRawMany<{ closingId: string; total: string | number }>();
      for (const row of raw) {
        totals.set(row.closingId, n(row.total));
      }
    }
    return rows.map((r) => this.toDto(r, { expensesTotal: totals.get(r.id) ?? 0 }));
  }

  async queryFiltered(shopId: string, filters: ClosingListFilters, withRelations = false): Promise<CashClosing[]> {
    const qb = this.closings.createQueryBuilder('c').where('c.shopId = :shopId', { shopId }).andWhere('c.active = true');
    applyClosingFilters(qb, 'c', filters);
    if (withRelations) {
      qb.leftJoinAndSelect('c.expenses', 'expenses')
        .leftJoinAndSelect('c.extraLines', 'extraLines')
        .leftJoinAndSelect('c.sourceAmounts', 'sourceAmounts');
    }
    qb.orderBy('c.businessDate', 'DESC');
    return qb.getMany();
  }

  async getOne(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({
      where: { id, shopId },
      relations: ['expenses', 'extraLines', 'sourceAmounts'],
    });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    return this.toDto(row);
  }

  async create(user: AuthUser, shopId: string, dto: CreateClosingDto) {
    this.shops.assertShopAccess(user, shopId);
    const shift = await this.resolveClosingShift(shopId, dto.shiftId);
    const dateKey = closingDateKey(dto.businessDate, shift.id);
    const exists = await this.closings.findOne({ where: { shopId, businessDateKey: dateKey } });
    if (exists) throw new ConflictException('Ya existe un cierre para esa fecha y turno');
    const normalized = this.applyPosnetSums(dto);
    const posnetAmounts = this.normalizePosnetAmounts(normalized.posnetAmounts);
    const incomeExtras = (normalized.extraLines ?? [])
      .filter((e) => e.type === ExtraLineType.STUDENT_CASH || e.type === ExtraLineType.ADJUSTMENT)
      .reduce((s, e) => s + n(e.amount), 0);
    const sourceDeclared = await this.declaredFromSources(shopId, normalized);
    const totals = this.calc(normalized, incomeExtras + sourceDeclared);
    const withdrawn = await this.resolveWithdrawnBy(
      shopId,
      normalized.cashWithdrawnByUserId,
      normalized.cashWithdrawnByName,
      normalized.cashWithdrawnByEmployeeId,
    );
    const cashWithdrawnToAccountId = await this.resolveWithdrawnToAccount(
      shopId,
      n(normalized.cashWithdrawn),
      n(normalized.cashAmount),
      withdrawn.cashWithdrawnByUserId,
      normalized.cashWithdrawnToAccountId,
    );
    const closing = await this.closings.save(this.closings.create({
      shopId, businessDate: normalized.businessDate, businessDateKey: dateKey,
      shiftId: shift.id, shiftName: shift.name,
      posSystemAmount: money(n(normalized.posSystemAmount)), cardAmount: money(n(normalized.cardAmount)),
      cashAmount: money(n(normalized.cashAmount)), mercadoPagoAmount: money(n(normalized.mercadoPagoAmount)),
      deliveryAppsAmount: money(n(normalized.deliveryAppsAmount)), transferAmount: money(n(normalized.transferAmount)),
      accountDniAmount: money(n(normalized.accountDniAmount)), otherAmount: money(n(normalized.otherAmount)),
      posnetAmounts,
      unitsSold: normalized.unitsSold ?? null, coversCount: normalized.coversCount ?? null,
      averageTicket: normalized.averageTicket != null ? money(normalized.averageTicket) : null,
      cashOpeningAmount: money(n(normalized.cashOpeningAmount)),
      cashLeftInRegister: money(n(normalized.cashLeftInRegister)), cashPendingPickup: money(n(normalized.cashPendingPickup)),
      cashWithdrawn: money(n(normalized.cashWithdrawn)),
      cashWithdrawnByUserId: withdrawn.cashWithdrawnByUserId,
      cashWithdrawnByEmployeeId: withdrawn.cashWithdrawnByEmployeeId,
      cashWithdrawnByName: withdrawn.cashWithdrawnByName,
      cashWithdrawnToAccountId,
      tipsAmount: money(n(normalized.tipsAmount)), declaredTotal: money(totals.declaredTotal),
      calculatedTotal: money(totals.calculatedTotal), difference: money(totals.difference),
      differenceReason: normalized.differenceReason ?? null, notes: normalized.notes ?? null,
      evidenceUrl: normalized.evidenceUrl ?? null,
      status: ClosingStatus.SUBMITTED, createdByUserId: user.id, submittedAt: new Date(), active: true,
    }));
    await this.replaceChildren(closing.id, normalized as CreateClosingDto, shopId);
    await this.syncMovements(closing.id);
    await this.syncTipsFromClosing(user, shopId, closing.id, normalized as CreateClosingDto);
    const created = await this.getOne(user, shopId, closing.id);
    void this.notifyAdminsClosingCreated(user, shopId, created).catch((err) => {
      this.logger.warn(
        `No se pudo notificar cierre ${closing.id}: ${(err as Error)?.message ?? err}`,
      );
    });
    return created;
  }

  async update(user: AuthUser, shopId: string, id: string, dto: UpdateClosingDto) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({
      where: { id, shopId },
      relations: ['expenses', 'extraLines', 'sourceAmounts'],
    });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    if (row.status === ClosingStatus.LOCKED && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException('El cierre está bloqueado');
    }
    const shift = await this.resolveClosingShift(shopId, dto.shiftId ?? row.shiftId);
    const nextDate = dto.businessDate ?? row.businessDate;
    const nextKey = closingDateKey(nextDate, shift.id);
    if (nextKey !== row.businessDateKey) {
      const clash = await this.closings.findOne({
        where: { shopId, businessDateKey: nextKey },
      });
      if (clash && clash.id !== row.id) {
        throw new ConflictException('Ya existe un cierre para esa fecha y turno');
      }
    }
    const mergedRaw: CreateClosingDto = {
      businessDate: dto.businessDate ?? row.businessDate,
      posSystemAmount: dto.posSystemAmount ?? n(row.posSystemAmount),
      cardAmount: dto.cardAmount ?? n(row.cardAmount), cashAmount: dto.cashAmount ?? n(row.cashAmount),
      mercadoPagoAmount: dto.mercadoPagoAmount ?? n(row.mercadoPagoAmount),
      deliveryAppsAmount: dto.deliveryAppsAmount ?? n(row.deliveryAppsAmount),
      transferAmount: dto.transferAmount ?? n(row.transferAmount),
      accountDniAmount: dto.accountDniAmount ?? n(row.accountDniAmount),
      otherAmount: dto.otherAmount ?? n(row.otherAmount),
      posnetAmounts: dto.posnetAmounts,
      unitsSold: dto.unitsSold !== undefined ? dto.unitsSold : row.unitsSold ?? undefined,
      coversCount: dto.coversCount !== undefined ? dto.coversCount : row.coversCount ?? undefined,
      averageTicket: dto.averageTicket !== undefined ? dto.averageTicket : row.averageTicket != null ? n(row.averageTicket) : undefined,
      cashOpeningAmount: dto.cashOpeningAmount ?? n(row.cashOpeningAmount),
      cashLeftInRegister: dto.cashLeftInRegister ?? n(row.cashLeftInRegister),
      cashPendingPickup: dto.cashPendingPickup ?? n(row.cashPendingPickup),
      cashWithdrawn: dto.cashWithdrawn ?? n(row.cashWithdrawn),
      cashWithdrawnByUserId: dto.cashWithdrawnByUserId ?? row.cashWithdrawnByUserId ?? undefined,
      cashWithdrawnByEmployeeId: dto.cashWithdrawnByEmployeeId ?? row.cashWithdrawnByEmployeeId ?? undefined,
      cashWithdrawnByName: dto.cashWithdrawnByName ?? row.cashWithdrawnByName ?? undefined,
      cashWithdrawnToAccountId:
        dto.cashWithdrawnToAccountId !== undefined
          ? dto.cashWithdrawnToAccountId
          : row.cashWithdrawnToAccountId ?? undefined,
      tipsAmount: dto.tipsAmount ?? n(row.tipsAmount), declaredTotal: dto.declaredTotal,
      differenceReason: dto.differenceReason ?? row.differenceReason ?? undefined,
      notes: dto.notes ?? row.notes ?? undefined, evidenceUrl: dto.evidenceUrl ?? row.evidenceUrl ?? undefined,
      expenses: dto.expenses, extraLines: dto.extraLines, sourceAmounts: dto.sourceAmounts,
    };
    const merged = (
      dto.posnetAmounts !== undefined ? this.applyPosnetSums(mergedRaw) : mergedRaw
    ) as CreateClosingDto;
    const posnetAmounts =
      dto.posnetAmounts !== undefined
        ? this.normalizePosnetAmounts(merged.posnetAmounts)
        : row.posnetAmounts ?? null;
    const incomeExtras = (merged.extraLines ?? row.extraLines ?? [])
      .map((e: any) => ({ type: e.type, amount: n(e.amount) }))
      .filter((e) => e.type === ExtraLineType.STUDENT_CASH || e.type === ExtraLineType.ADJUSTMENT)
      .reduce((s, e) => s + e.amount, 0);
    const sourceDeclared = await this.declaredFromSources(shopId, {
      sourceAmounts:
        merged.sourceAmounts ??
        row.sourceAmounts
          ?.filter((s): s is typeof s & { sourceId: string } => !!s.sourceId)
          .map((s) => ({ sourceId: s.sourceId, amount: n(s.amount) })),
    });
    const totals = this.calc(merged, incomeExtras + sourceDeclared);
    const withdrawn = await this.resolveWithdrawnBy(shopId, merged.cashWithdrawnByUserId, merged.cashWithdrawnByName, merged.cashWithdrawnByEmployeeId);
    const cashWithdrawnToAccountId = await this.resolveWithdrawnToAccount(
      shopId,
      n(merged.cashWithdrawn),
      n(merged.cashAmount),
      withdrawn.cashWithdrawnByUserId,
      merged.cashWithdrawnToAccountId,
    );
    Object.assign(row, {
      businessDate: merged.businessDate,
      businessDateKey: closingDateKey(merged.businessDate, shift.id),
      shiftId: shift.id,
      shiftName: shift.name,
      posSystemAmount: money(n(merged.posSystemAmount)), cardAmount: money(n(merged.cardAmount)),
      cashAmount: money(n(merged.cashAmount)), mercadoPagoAmount: money(n(merged.mercadoPagoAmount)),
      deliveryAppsAmount: money(n(merged.deliveryAppsAmount)), transferAmount: money(n(merged.transferAmount)),
      accountDniAmount: money(n(merged.accountDniAmount)), otherAmount: money(n(merged.otherAmount)),
      posnetAmounts,
      unitsSold: merged.unitsSold ?? null, coversCount: merged.coversCount ?? null,
      averageTicket: merged.averageTicket != null ? money(merged.averageTicket) : null,
      cashOpeningAmount: money(n(merged.cashOpeningAmount)),
      cashLeftInRegister: money(n(merged.cashLeftInRegister)), cashPendingPickup: money(n(merged.cashPendingPickup)),
      cashWithdrawn: money(n(merged.cashWithdrawn)),
      cashWithdrawnByUserId: withdrawn.cashWithdrawnByUserId,
      cashWithdrawnByEmployeeId: withdrawn.cashWithdrawnByEmployeeId,
      cashWithdrawnByName: withdrawn.cashWithdrawnByName,
      cashWithdrawnToAccountId,
      tipsAmount: money(n(merged.tipsAmount)), declaredTotal: money(totals.declaredTotal),
      calculatedTotal: money(totals.calculatedTotal), difference: money(totals.difference),
      differenceReason: merged.differenceReason ?? null, notes: merged.notes ?? null,
      evidenceUrl: merged.evidenceUrl ?? null, status: row.status,
    });
    await this.closings.save(row);
    if (dto.expenses || dto.extraLines || dto.sourceAmounts) {
      await this.replaceChildren(row.id, {
        expenses: dto.expenses ?? row.expenses?.map((e) => ({
          label: e.label,
          amount: n(e.amount),
          category: e.category,
          conceptId: e.conceptId ?? null,
          notes: e.notes ?? null,
        })),
        extraLines: dto.extraLines ?? row.extraLines?.map((e) => ({ type: e.type, label: e.label, amount: n(e.amount), meta: e.meta ?? undefined })),
        sourceAmounts: dto.sourceAmounts,
      }, shopId);
    }
    await this.syncMovements(row.id);
    await this.syncTipsFromClosing(user, shopId, row.id, merged);
    return this.getOne(user, shopId, id);
  }

  private async syncTipsFromClosing(
    user: AuthUser,
    shopId: string,
    closingId: string,
    dto: CreateClosingDto,
  ) {
    try {
      const tip = (dto as CreateClosingDto & {
        tipCashAmount?: number;
        tipTransferAmount?: number;
        tipTicketsAmount?: number;
        tipReceipts?: number[];
        tipNotes?: string | null;
        tipAllocations?: Array<{ employeeId: string; amount: number; delivered?: boolean }>;
      });
      await this.tips.syncFromClosing(user, shopId, dto.businessDate, {
        cashAmount: tip.tipCashAmount,
        transferAmount: tip.tipTransferAmount,
        ticketsAmount: tip.tipTicketsAmount,
        receipts: tip.tipReceipts,
        notes: tip.tipNotes,
        tipsAmount: dto.tipsAmount,
        closingId,
        allocations: tip.tipAllocations,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo sincronizar propinas del cierre ${closingId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  async previewReloadIncomes(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    assertCanViewClosingsList(user, shopId);
    return this.closingMovements.previewMissingIncomes(shopId);
  }

  async commitReloadIncomes(
    user: AuthUser,
    shopId: string,
    selected?: Array<{
      closingId: string;
      toAccountId: string;
      amount: number;
      label: string;
    }>,
  ) {
    this.shops.assertShopAccess(user, shopId);
    return this.closingMovements.commitMissingIncomes(shopId, selected);
  }

  async lock(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({
      where: { id, shopId },
      relations: ['expenses', 'extraLines', 'sourceAmounts'],
    });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    row.status = ClosingStatus.LOCKED;
    await this.closings.save(row);
    await this.syncMovements(row.id);
    return this.getOne(user, shopId, id);
  }

  async unlock(user: AuthUser, shopId: string, id: string) {
    if (!isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new ForbiddenException('Solo un super admin puede desbloquear cierres');
    }
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({
      where: { id, shopId },
      relations: ['expenses', 'extraLines', 'sourceAmounts'],
    });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    row.status = ClosingStatus.SUBMITTED;
    await this.closings.save(row);
    return this.getOne(user, shopId, id);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    if (!isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new ForbiddenException('Solo un super admin puede eliminar cierres');
    }
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({
      where: { id, shopId },
      relations: ['expenses', 'extraLines', 'sourceAmounts'],
    });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    await this.closingMovements.syncFromClosing({
      ...row,
      expenses: [],
      extraLines: [],
      sourceAmounts: [],
    } as CashClosing);
    await this.cashWithdrawals.cancelForClosing(id);
    await this.expenses.delete({ closingId: id });
    await this.extras.delete({ closingId: id });
    await this.sourceAmounts.delete({ closingId: id });
    row.businessDateKey = markDeletedUnique(
      row.businessDateKey || closingDateKey(row.businessDate),
      row.id,
      80,
    );
    row.active = false;
    await this.closings.save(row);
    await this.closings.softRemove(row);
    return { ok: true };
  }

  private async replaceChildren(
    closingId: string,
    dto: {
      expenses?: CreateClosingDto['expenses'];
      extraLines?: CreateClosingDto['extraLines'];
      sourceAmounts?: CreateClosingDto['sourceAmounts'];
    },
    shopId: string,
  ) {
    if (dto.expenses) {
      await this.expenses.delete({ closingId });
      if (dto.expenses.length) {
        await this.expenses.save(dto.expenses.map((e) => this.expenses.create({
          closingId,
          label: e.label,
          amount: money(n(e.amount)),
          category: e.category ?? ExpenseCategory.OTHER,
          conceptId: e.conceptId ?? null,
          notes: e.notes?.trim() || null,
        })));
      }
    }
    if (dto.extraLines) {
      await this.extras.delete({ closingId });
      if (dto.extraLines.length) {
        await this.extras.save(dto.extraLines.map((e) => this.extras.create({
          closingId, type: e.type, label: e.label, amount: money(n(e.amount)), meta: e.meta ?? null,
        })));
      }
    }
    if (dto.sourceAmounts) {
      const existing = await this.sourceAmounts.find({ where: { closingId } });
      const settledKeep = existing.filter((s) => !!s.settledAt);
      const settledBySourceId = new Map(
        settledKeep
          .filter((s) => !!s.sourceId)
          .map((s) => [s.sourceId as string, s]),
      );
      if (settledKeep.length) {
        await this.sourceAmounts
          .createQueryBuilder()
          .delete()
          .from(ClosingSourceAmount)
          .where('closingId = :closingId', { closingId })
          .andWhere('settledAt IS NULL')
          .execute();
      } else {
        await this.sourceAmounts.delete({ closingId });
      }
      const defs = await this.sources.find({ where: { shopId } });
      const byId = new Map(defs.map((s) => [s.id, s]));
      const incomingSettledIds = new Set<string>();
      const rows = dto.sourceAmounts
        .map((row) => {
          const src = byId.get(row.sourceId);
          if (!src) return null;
          const lines = sourceLinesOf(row.lines);
          const amount = sourceAmountOf(row);
          const settled = settledBySourceId.get(src.id);
          if (settled) {
            incomingSettledIds.add(settled.id);
            settled.name = src.name;
            settled.includeInDeclared = !!src.includeInDeclared;
            settled.kind = src.kind;
            settled.accountId = src.accountId ?? null;
            settled.amount = money(amount);
            settled.lines = lines.length ? lines : null;
            return settled;
          }
          return this.sourceAmounts.create({
            closingId,
            sourceId: src.id,
            name: src.name,
            includeInDeclared: !!src.includeInDeclared,
            kind: src.kind,
            accountId: src.accountId ?? null,
            amount: money(amount),
            lines: lines.length ? lines : null,
          });
        })
        .filter((r): r is NonNullable<typeof r> => !!r);
      const leftoverSettled = settledKeep.filter((s) => !incomingSettledIds.has(s.id));
      const toSave = [...rows, ...leftoverSettled];
      if (toSave.length) await this.sourceAmounts.save(toSave);
    }
  }

  /** Notifica a admins del local (OWNER/ADMIN) que se registró un cierre. */
  private async notifyAdminsClosingCreated(
    actor: AuthUser,
    shopId: string,
    closing: {
      id: string;
      businessDate: string;
      declaredTotal: number;
      cashPendingPickup?: number;
      cashWithdrawnByUserId?: string | null;
      cashWithdrawnByEmployeeId?: string | null;
    },
  ) {
    const shop = await this.shopRepo.findOne({ where: { id: shopId } });
    const shopName = shop?.name?.trim() || 'Local';
    const links = await this.userShops.find({
      where: {
        shopId,
        shopRole: In([GlobalRole.OWNER, GlobalRole.ADMIN]),
      },
    });
    const recipientIds = new Set(links.map((l) => l.userId));

    // Super admins globales con acceso al local (OWNER global ve todos).
    const globalOwners = await this.users.find({
      where: { globalRole: GlobalRole.OWNER },
      select: ['id', 'active'],
    });
    for (const u of globalOwners) {
      if (isEntityActive(u.active)) recipientIds.add(u.id);
    }

    recipientIds.delete(actor.id);
    if (!recipientIds.size) return;

    const date = String(closing.businessDate || '').slice(0, 10);
    const total = Number(closing.declaredTotal || 0).toLocaleString('es-AR');
    const title = 'Nuevo cierre de caja';
    const parts = [
      shopName,
      date,
      `$${total}`,
      `por ${actor.fullName || actor.email}`,
    ];
    const hasWho = !!(closing.cashWithdrawnByUserId || closing.cashWithdrawnByEmployeeId);
    const pendingAmount = Number(closing.cashPendingPickup || 0);
    if (!hasWho && pendingAmount > 0) {
      parts.push(
        `Hay $${pendingAmount.toLocaleString('es-AR')} para retirar en A Retirar`,
      );
    }
    const body = parts.join(' · ');

    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.CLOSING_CREATED,
        title,
        body,
        closingId: closing.id,
      })),
    );
  }
}
