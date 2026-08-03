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
import { Repository } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { User } from '../../entities/user.entity';
import { Employee } from '../../entities/employee.entity';
import { ShopsService } from '../shops/shops.service';
import { ClosingMovementsSyncService } from '../movements/closing-movements-sync.service';
import { AccountsService } from '../accounts/accounts.service';
import { AuthUser } from '../../common/decorators';
import { ClosingStatus, ExpenseCategory, ExtraLineType, GlobalRole } from '../../common/enums';
import { isGlobalAdmin } from '../../common/guards';
import { closingDateKey, markDeletedUnique } from '../../common/soft-delete.util';
import { CreateClosingDto, UpdateClosingDto } from './dto/closing.dto';
import { applyClosingFilters, ClosingListFilters } from './closing-filters';
import { ClosingPosnetAmount, sumPosnetsByType } from '../../common/posnet';

const n = (v?: number | string | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class ClosingsService implements OnModuleInit {
  private readonly logger = new Logger(ClosingsService.name);

  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(ClosingExpense) private readonly expenses: Repository<ClosingExpense>,
    @InjectRepository(ClosingExtraLine) private readonly extras: Repository<ClosingExtraLine>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    private readonly shops: ShopsService,
    private readonly closingMovements: ClosingMovementsSyncService,
    private readonly accounts: AccountsService,
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
          ADD COLUMN cashWithdrawnToAccountId VARCHAR(36) NULL
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

  private toDto(c: CashClosing) {
    return {
      id: c.id, shopId: c.shopId, businessDate: c.businessDate,
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
      cashLeftInRegister: n(c.cashLeftInRegister), cashPendingPickup: n(c.cashPendingPickup),
      cashWithdrawn: n(c.cashWithdrawn), cashWithdrawnByUserId: c.cashWithdrawnByUserId,
      cashWithdrawnByEmployeeId: c.cashWithdrawnByEmployeeId ?? null, cashWithdrawnByName: c.cashWithdrawnByName,
      cashWithdrawnToAccountId: c.cashWithdrawnToAccountId ?? null,
      tipsAmount: n(c.tipsAmount), declaredTotal: n(c.declaredTotal), calculatedTotal: n(c.calculatedTotal),
      difference: n(c.difference), differenceReason: c.differenceReason, notes: c.notes,
      evidenceUrl: c.evidenceUrl, status: c.status, createdByUserId: c.createdByUserId, submittedAt: c.submittedAt,
      expenses: (c.expenses ?? []).map((e) => ({ id: e.id, label: e.label, amount: n(e.amount), category: e.category })),
      extraLines: (c.extraLines ?? []).map((e) => ({ id: e.id, type: e.type, label: e.label, amount: n(e.amount), meta: e.meta })),
    };
  }

  private async syncMovements(closingId: string) {
    const full = await this.closings.findOne({ where: { id: closingId }, relations: ['expenses', 'extraLines'] });
    if (full) await this.closingMovements.syncFromClosing(full);
  }

  async list(user: AuthUser, shopId: string, filters: ClosingListFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    return (await this.queryFiltered(shopId, filters, true)).map((r) => this.toDto(r));
  }

  async queryFiltered(shopId: string, filters: ClosingListFilters, withRelations = false): Promise<CashClosing[]> {
    const qb = this.closings.createQueryBuilder('c').where('c.shopId = :shopId', { shopId }).andWhere('c.active = true');
    applyClosingFilters(qb, 'c', filters);
    if (withRelations) qb.leftJoinAndSelect('c.expenses', 'expenses').leftJoinAndSelect('c.extraLines', 'extraLines');
    qb.orderBy('c.businessDate', 'DESC');
    return qb.getMany();
  }

  async getOne(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({ where: { id, shopId }, relations: ['expenses', 'extraLines'] });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    return this.toDto(row);
  }

  async create(user: AuthUser, shopId: string, dto: CreateClosingDto) {
    this.shops.assertShopAccess(user, shopId);
    const dateKey = closingDateKey(dto.businessDate);
    const exists = await this.closings.findOne({ where: { shopId, businessDateKey: dateKey } });
    if (exists) throw new ConflictException('Ya existe un cierre para esa fecha');
    const normalized = this.applyPosnetSums(dto);
    const posnetAmounts = this.normalizePosnetAmounts(normalized.posnetAmounts);
    const incomeExtras = (normalized.extraLines ?? [])
      .filter((e) => e.type === ExtraLineType.STUDENT_CASH || e.type === ExtraLineType.ADJUSTMENT)
      .reduce((s, e) => s + n(e.amount), 0);
    const totals = this.calc(normalized, incomeExtras);
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
      posSystemAmount: money(n(normalized.posSystemAmount)), cardAmount: money(n(normalized.cardAmount)),
      cashAmount: money(n(normalized.cashAmount)), mercadoPagoAmount: money(n(normalized.mercadoPagoAmount)),
      deliveryAppsAmount: money(n(normalized.deliveryAppsAmount)), transferAmount: money(n(normalized.transferAmount)),
      accountDniAmount: money(n(normalized.accountDniAmount)), otherAmount: money(n(normalized.otherAmount)),
      posnetAmounts,
      unitsSold: normalized.unitsSold ?? null, coversCount: normalized.coversCount ?? null,
      averageTicket: normalized.averageTicket != null ? money(normalized.averageTicket) : null,
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
    await this.replaceChildren(closing.id, normalized as CreateClosingDto);
    await this.syncMovements(closing.id);
    return this.getOne(user, shopId, closing.id);
  }

  async update(user: AuthUser, shopId: string, id: string, dto: UpdateClosingDto) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({ where: { id, shopId }, relations: ['expenses', 'extraLines'] });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    if (row.status === ClosingStatus.LOCKED && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException('El cierre está bloqueado');
    }
    if (dto.businessDate && dto.businessDate !== row.businessDate) {
      const clash = await this.closings.findOne({
        where: { shopId, businessDateKey: closingDateKey(dto.businessDate) },
      });
      if (clash) throw new ConflictException('Ya existe un cierre para esa fecha');
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
      expenses: dto.expenses, extraLines: dto.extraLines,
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
    const totals = this.calc(merged, incomeExtras);
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
      businessDateKey: closingDateKey(merged.businessDate),
      posSystemAmount: money(n(merged.posSystemAmount)), cardAmount: money(n(merged.cardAmount)),
      cashAmount: money(n(merged.cashAmount)), mercadoPagoAmount: money(n(merged.mercadoPagoAmount)),
      deliveryAppsAmount: money(n(merged.deliveryAppsAmount)), transferAmount: money(n(merged.transferAmount)),
      accountDniAmount: money(n(merged.accountDniAmount)), otherAmount: money(n(merged.otherAmount)),
      posnetAmounts,
      unitsSold: merged.unitsSold ?? null, coversCount: merged.coversCount ?? null,
      averageTicket: merged.averageTicket != null ? money(merged.averageTicket) : null,
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
    if (dto.expenses || dto.extraLines) {
      await this.replaceChildren(row.id, {
        expenses: dto.expenses ?? row.expenses?.map((e) => ({ label: e.label, amount: n(e.amount), category: e.category })),
        extraLines: dto.extraLines ?? row.extraLines?.map((e) => ({ type: e.type, label: e.label, amount: n(e.amount), meta: e.meta ?? undefined })),
      });
    }
    await this.syncMovements(row.id);
    return this.getOne(user, shopId, id);
  }

  async lock(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({ where: { id, shopId }, relations: ['expenses', 'extraLines'] });
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
    const row = await this.closings.findOne({ where: { id, shopId }, relations: ['expenses', 'extraLines'] });
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
    const row = await this.closings.findOne({ where: { id, shopId }, relations: ['expenses', 'extraLines'] });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    await this.closingMovements.syncFromClosing({ ...row, expenses: [], extraLines: [] } as CashClosing);
    await this.expenses.delete({ closingId: id });
    await this.extras.delete({ closingId: id });
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
    dto: { expenses?: CreateClosingDto['expenses']; extraLines?: CreateClosingDto['extraLines'] },
  ) {
    if (dto.expenses) {
      await this.expenses.delete({ closingId });
      if (dto.expenses.length) {
        await this.expenses.save(dto.expenses.map((e) => this.expenses.create({
          closingId, label: e.label, amount: money(n(e.amount)), category: e.category ?? ExpenseCategory.OTHER,
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
  }
}
