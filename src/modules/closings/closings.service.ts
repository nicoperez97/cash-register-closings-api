import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { User } from '../../entities/user.entity';
import { ShopsService } from '../shops/shops.service';
import { AuthUser } from '../../common/decorators';
import { ClosingStatus, ExpenseCategory, ExtraLineType } from '../../common/enums';
import { CreateClosingDto, UpdateClosingDto } from './dto/closing.dto';
import { applyClosingFilters, ClosingListFilters } from './closing-filters';

const n = (v?: number | string | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class ClosingsService {
  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(ClosingExpense) private readonly expenses: Repository<ClosingExpense>,
    @InjectRepository(ClosingExtraLine) private readonly extras: Repository<ClosingExtraLine>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly shops: ShopsService,
  ) {}

  private async resolveWithdrawnBy(
    userId?: string | null,
    name?: string | null,
  ): Promise<{ cashWithdrawnByUserId: string | null; cashWithdrawnByName: string | null }> {
    if (userId) {
      const u = await this.users.findOne({ where: { id: userId, active: true } });
      if (u) {
        return { cashWithdrawnByUserId: u.id, cashWithdrawnByName: u.fullName };
      }
    }
    const trimmed = name?.trim() || null;
    return { cashWithdrawnByUserId: userId ?? null, cashWithdrawnByName: trimmed };
  }

  private calc(dto: Partial<CreateClosingDto>, extraIncome = 0) {
    const calculated =
      n(dto.cardAmount) +
      n(dto.cashAmount) +
      n(dto.mercadoPagoAmount) +
      n(dto.deliveryAppsAmount) +
      n(dto.transferAmount) +
      n(dto.accountDniAmount) +
      n(dto.otherAmount) +
      extraIncome;
    const declared = dto.declaredTotal !== undefined ? n(dto.declaredTotal) : calculated;
    const difference = n(dto.posSystemAmount) - declared;
    return { calculatedTotal: calculated, declaredTotal: declared, difference };
  }

  private toDto(c: CashClosing) {
    return {
      id: c.id,
      shopId: c.shopId,
      businessDate: c.businessDate,
      posSystemAmount: n(c.posSystemAmount),
      cardAmount: n(c.cardAmount),
      cashAmount: n(c.cashAmount),
      mercadoPagoAmount: n(c.mercadoPagoAmount),
      deliveryAppsAmount: n(c.deliveryAppsAmount),
      transferAmount: n(c.transferAmount),
      accountDniAmount: n(c.accountDniAmount),
      otherAmount: n(c.otherAmount),
      unitsSold: c.unitsSold,
      coversCount: c.coversCount,
      averageTicket: c.averageTicket != null ? n(c.averageTicket) : null,
      cashLeftInRegister: n(c.cashLeftInRegister),
      cashPendingPickup: n(c.cashPendingPickup),
      cashWithdrawn: n(c.cashWithdrawn),
      cashWithdrawnByUserId: c.cashWithdrawnByUserId,
      cashWithdrawnByName: c.cashWithdrawnByName,
      tipsAmount: n(c.tipsAmount),
      declaredTotal: n(c.declaredTotal),
      calculatedTotal: n(c.calculatedTotal),
      difference: n(c.difference),
      differenceReason: c.differenceReason,
      notes: c.notes,
      evidenceUrl: c.evidenceUrl,
      status: c.status,
      createdByUserId: c.createdByUserId,
      submittedAt: c.submittedAt,
      expenses: (c.expenses ?? []).map((e) => ({
        id: e.id,
        label: e.label,
        amount: n(e.amount),
        category: e.category,
      })),
      extraLines: (c.extraLines ?? []).map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
        amount: n(e.amount),
        meta: e.meta,
      })),
    };
  }

  async list(user: AuthUser, shopId: string, filters: ClosingListFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.queryFiltered(shopId, filters, true);
    return rows.map((r) => this.toDto(r));
  }

  /** Consulta filtrada reutilizable (lista / reportes). */
  async queryFiltered(
    shopId: string,
    filters: ClosingListFilters,
    withRelations = false,
  ): Promise<CashClosing[]> {
    const qb = this.closings
      .createQueryBuilder('c')
      .where('c.shopId = :shopId', { shopId })
      .andWhere('c.active = true');
    applyClosingFilters(qb, 'c', filters);
    if (withRelations) {
      qb.leftJoinAndSelect('c.expenses', 'expenses').leftJoinAndSelect(
        'c.extraLines',
        'extraLines',
      );
    }
    qb.orderBy('c.businessDate', 'DESC');
    return qb.getMany();
  }

  async getOne(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({
      where: { id, shopId },
      relations: ['expenses', 'extraLines'],
    });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    return this.toDto(row);
  }

  async create(user: AuthUser, shopId: string, dto: CreateClosingDto) {
    this.shops.assertShopAccess(user, shopId);
    const exists = await this.closings.findOne({
      where: { shopId, businessDate: dto.businessDate },
    });
    if (exists) throw new ConflictException('Ya existe un cierre para esa fecha');

    const incomeExtras = (dto.extraLines ?? [])
      .filter((e) => e.type === ExtraLineType.STUDENT_CASH || e.type === ExtraLineType.ADJUSTMENT)
      .reduce((s, e) => s + n(e.amount), 0);
    const totals = this.calc(dto, incomeExtras);
    const withdrawn = await this.resolveWithdrawnBy(
      dto.cashWithdrawnByUserId,
      dto.cashWithdrawnByName,
    );

    const closing = await this.closings.save(
      this.closings.create({
        shopId,
        businessDate: dto.businessDate,
        posSystemAmount: money(n(dto.posSystemAmount)),
        cardAmount: money(n(dto.cardAmount)),
        cashAmount: money(n(dto.cashAmount)),
        mercadoPagoAmount: money(n(dto.mercadoPagoAmount)),
        deliveryAppsAmount: money(n(dto.deliveryAppsAmount)),
        transferAmount: money(n(dto.transferAmount)),
        accountDniAmount: money(n(dto.accountDniAmount)),
        otherAmount: money(n(dto.otherAmount)),
        unitsSold: dto.unitsSold ?? null,
        coversCount: dto.coversCount ?? null,
        averageTicket: dto.averageTicket != null ? money(dto.averageTicket) : null,
        cashLeftInRegister: money(n(dto.cashLeftInRegister)),
        cashPendingPickup: money(n(dto.cashPendingPickup)),
        cashWithdrawn: money(n(dto.cashWithdrawn)),
        cashWithdrawnByUserId: withdrawn.cashWithdrawnByUserId,
        cashWithdrawnByName: withdrawn.cashWithdrawnByName,
        tipsAmount: money(n(dto.tipsAmount)),
        declaredTotal: money(totals.declaredTotal),
        calculatedTotal: money(totals.calculatedTotal),
        difference: money(totals.difference),
        differenceReason: dto.differenceReason ?? null,
        notes: dto.notes ?? null,
        evidenceUrl: dto.evidenceUrl ?? null,
        status: dto.status ?? ClosingStatus.SUBMITTED,
        createdByUserId: user.id,
        submittedAt: new Date(),
        active: true,
      }),
    );

    await this.replaceChildren(closing.id, dto);
    return this.getOne(user, shopId, closing.id);
  }

  async update(user: AuthUser, shopId: string, id: string, dto: UpdateClosingDto) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({
      where: { id, shopId },
      relations: ['expenses', 'extraLines'],
    });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    if (row.status === ClosingStatus.LOCKED) {
      throw new BadRequestException('El cierre está bloqueado');
    }

    if (dto.businessDate && dto.businessDate !== row.businessDate) {
      const clash = await this.closings.findOne({
        where: { shopId, businessDate: dto.businessDate },
      });
      if (clash) throw new ConflictException('Ya existe un cierre para esa fecha');
    }

    const merged: CreateClosingDto = {
      businessDate: dto.businessDate ?? row.businessDate,
      posSystemAmount: dto.posSystemAmount ?? n(row.posSystemAmount),
      cardAmount: dto.cardAmount ?? n(row.cardAmount),
      cashAmount: dto.cashAmount ?? n(row.cashAmount),
      mercadoPagoAmount: dto.mercadoPagoAmount ?? n(row.mercadoPagoAmount),
      deliveryAppsAmount: dto.deliveryAppsAmount ?? n(row.deliveryAppsAmount),
      transferAmount: dto.transferAmount ?? n(row.transferAmount),
      accountDniAmount: dto.accountDniAmount ?? n(row.accountDniAmount),
      otherAmount: dto.otherAmount ?? n(row.otherAmount),
      unitsSold: dto.unitsSold !== undefined ? dto.unitsSold : row.unitsSold ?? undefined,
      coversCount: dto.coversCount !== undefined ? dto.coversCount : row.coversCount ?? undefined,
      averageTicket:
        dto.averageTicket !== undefined
          ? dto.averageTicket
          : row.averageTicket != null
            ? n(row.averageTicket)
            : undefined,
      cashLeftInRegister: dto.cashLeftInRegister ?? n(row.cashLeftInRegister),
      cashPendingPickup: dto.cashPendingPickup ?? n(row.cashPendingPickup),
      cashWithdrawn: dto.cashWithdrawn ?? n(row.cashWithdrawn),
      cashWithdrawnByUserId: dto.cashWithdrawnByUserId ?? row.cashWithdrawnByUserId ?? undefined,
      cashWithdrawnByName: dto.cashWithdrawnByName ?? row.cashWithdrawnByName ?? undefined,
      tipsAmount: dto.tipsAmount ?? n(row.tipsAmount),
      declaredTotal: dto.declaredTotal,
      differenceReason: dto.differenceReason ?? row.differenceReason ?? undefined,
      notes: dto.notes ?? row.notes ?? undefined,
      evidenceUrl: dto.evidenceUrl ?? row.evidenceUrl ?? undefined,
      expenses: dto.expenses,
      extraLines: dto.extraLines,
    };

    const incomeExtras = (merged.extraLines ?? row.extraLines ?? [])
      .map((e: any) => ({ type: e.type, amount: n(e.amount) }))
      .filter((e) => e.type === ExtraLineType.STUDENT_CASH || e.type === ExtraLineType.ADJUSTMENT)
      .reduce((s, e) => s + e.amount, 0);
    const totals = this.calc(merged, incomeExtras);
    const withdrawn = await this.resolveWithdrawnBy(
      merged.cashWithdrawnByUserId,
      merged.cashWithdrawnByName,
    );

    Object.assign(row, {
      businessDate: merged.businessDate,
      posSystemAmount: money(n(merged.posSystemAmount)),
      cardAmount: money(n(merged.cardAmount)),
      cashAmount: money(n(merged.cashAmount)),
      mercadoPagoAmount: money(n(merged.mercadoPagoAmount)),
      deliveryAppsAmount: money(n(merged.deliveryAppsAmount)),
      transferAmount: money(n(merged.transferAmount)),
      accountDniAmount: money(n(merged.accountDniAmount)),
      otherAmount: money(n(merged.otherAmount)),
      unitsSold: merged.unitsSold ?? null,
      coversCount: merged.coversCount ?? null,
      averageTicket: merged.averageTicket != null ? money(merged.averageTicket) : null,
      cashLeftInRegister: money(n(merged.cashLeftInRegister)),
      cashPendingPickup: money(n(merged.cashPendingPickup)),
      cashWithdrawn: money(n(merged.cashWithdrawn)),
      cashWithdrawnByUserId: withdrawn.cashWithdrawnByUserId,
      cashWithdrawnByName: withdrawn.cashWithdrawnByName,
      tipsAmount: money(n(merged.tipsAmount)),
      declaredTotal: money(totals.declaredTotal),
      calculatedTotal: money(totals.calculatedTotal),
      difference: money(totals.difference),
      differenceReason: merged.differenceReason ?? null,
      notes: merged.notes ?? null,
      evidenceUrl: merged.evidenceUrl ?? null,
      status: dto.status ?? row.status,
    });
    await this.closings.save(row);

    if (dto.expenses || dto.extraLines) {
      await this.replaceChildren(row.id, {
        expenses: dto.expenses ?? row.expenses?.map((e) => ({
          label: e.label,
          amount: n(e.amount),
          category: e.category,
        })),
        extraLines: dto.extraLines ?? row.extraLines?.map((e) => ({
          type: e.type,
          label: e.label,
          amount: n(e.amount),
          meta: e.meta ?? undefined,
        })),
      });
    }

    return this.getOne(user, shopId, id);
  }

  async lock(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.closings.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    row.status = ClosingStatus.LOCKED;
    await this.closings.save(row);
    return this.getOne(user, shopId, id);
  }

  private async replaceChildren(
    closingId: string,
    dto: { expenses?: CreateClosingDto['expenses']; extraLines?: CreateClosingDto['extraLines'] },
  ) {
    if (dto.expenses) {
      await this.expenses.delete({ closingId });
      if (dto.expenses.length) {
        await this.expenses.save(
          dto.expenses.map((e) =>
            this.expenses.create({
              closingId,
              label: e.label,
              amount: money(n(e.amount)),
              category: e.category ?? ExpenseCategory.OTHER,
            }),
          ),
        );
      }
    }
    if (dto.extraLines) {
      await this.extras.delete({ closingId });
      if (dto.extraLines.length) {
        await this.extras.save(
          dto.extraLines.map((e) =>
            this.extras.create({
              closingId,
              type: e.type,
              label: e.label,
              amount: money(n(e.amount)),
              meta: e.meta ?? null,
            }),
          ),
        );
      }
    }
  }
}
