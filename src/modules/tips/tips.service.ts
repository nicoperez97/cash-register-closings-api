import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { TipDay } from '../../entities/tip-day.entity';
import { TipAllocation } from '../../entities/tip-allocation.entity';
import { Employee } from '../../entities/employee.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { AuthUser } from '../../common/decorators';
import { ShopsService } from '../shops/shops.service';
import { isEntityActive } from '../../common/active.util';

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function money(v: number): string {
  return v.toFixed(2);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export type TipAllocationInput = {
  employeeId: string;
  amount: number;
  delivered?: boolean;
};

export type UpsertTipDayInput = {
  cashAmount?: number;
  transferAmount?: number;
  ticketsAmount?: number;
  notes?: string | null;
  closingId?: string | null;
  allocations?: TipAllocationInput[];
};

@Injectable()
export class TipsService implements OnModuleInit {
  constructor(
    @InjectRepository(TipDay) private readonly tipDays: Repository<TipDay>,
    @InjectRepository(TipAllocation)
    private readonly allocations: Repository<TipAllocation>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(CashClosing)
    private readonly closings: Repository<CashClosing>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    for (const sql of [
      `ALTER TABLE shops ADD COLUMN tipsEnabled TINYINT(1) NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS tip_days (
        id CHAR(36) NOT NULL PRIMARY KEY,
        shopId CHAR(36) NOT NULL,
        businessDate DATE NOT NULL,
        cashAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
        transferAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
        ticketsAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
        totalAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
        notes VARCHAR(500) NULL,
        closingId CHAR(36) NULL,
        createdByUserId CHAR(36) NULL,
        createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt DATETIME(6) NULL,
        deletedAt DATETIME(6) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_tip_days_shop_date (shopId, businessDate),
        KEY idx_tip_days_shop (shopId),
        KEY idx_tip_days_date (businessDate)
      )`,
      `CREATE TABLE IF NOT EXISTS tip_allocations (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tipDayId CHAR(36) NOT NULL,
        employeeId CHAR(36) NOT NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        delivered TINYINT(1) NOT NULL DEFAULT 0,
        deliveredAt DATETIME(6) NULL,
        deliveredByUserId CHAR(36) NULL,
        createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt DATETIME(6) NULL,
        deletedAt DATETIME(6) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_tip_alloc_day_emp (tipDayId, employeeId),
        KEY idx_tip_alloc_day (tipDayId),
        KEY idx_tip_alloc_emp (employeeId),
        KEY idx_tip_alloc_delivered (delivered)
      )`,
    ]) {
      try {
        await this.tipDays.query(sql);
      } catch {
        // ya existe
      }
    }
  }

  private toAllocationDto(a: TipAllocation) {
    return {
      id: a.id,
      tipDayId: a.tipDayId,
      employeeId: a.employeeId,
      employeeName: a.employee?.fullName ?? null,
      amount: n(a.amount),
      delivered: !!a.delivered,
      deliveredAt: a.deliveredAt ?? null,
      deliveredByUserId: a.deliveredByUserId ?? null,
    };
  }

  private toDayDto(day: TipDay) {
    const allocations = (day.allocations ?? []).map((a) => this.toAllocationDto(a));
    const pendingCount = allocations.filter((a) => !a.delivered).length;
    return {
      id: day.id,
      shopId: day.shopId,
      businessDate: String(day.businessDate).slice(0, 10),
      cashAmount: n(day.cashAmount),
      transferAmount: n(day.transferAmount),
      ticketsAmount: n(day.ticketsAmount),
      totalAmount: n(day.totalAmount),
      notes: day.notes ?? null,
      closingId: day.closingId ?? null,
      createdByUserId: day.createdByUserId ?? null,
      pendingCount,
      allocations,
      createdAt: day.createdAt,
      updatedAt: day.updatedAt ?? null,
    };
  }

  async list(user: AuthUser, shopId: string, from?: string, to?: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertTipsEnabled(shopId);
    const where: Record<string, unknown> = { shopId, active: true };
    if (from && to) where.businessDate = Between(from, to);
    const rows = await this.tipDays.find({
      where,
      relations: ['allocations', 'allocations.employee'],
      order: { businessDate: 'DESC' },
    });
    return rows.map((d) => this.toDayDto(d));
  }

  async getByDate(user: AuthUser, shopId: string, businessDate: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertTipsEnabled(shopId);
    const day = await this.tipDays.findOne({
      where: { shopId, businessDate, active: true },
      relations: ['allocations', 'allocations.employee'],
    });
    if (!day) {
      return {
        id: null,
        shopId,
        businessDate,
        cashAmount: 0,
        transferAmount: 0,
        ticketsAmount: 0,
        totalAmount: 0,
        notes: null,
        closingId: null,
        createdByUserId: null,
        pendingCount: 0,
        allocations: [],
        createdAt: null,
        updatedAt: null,
      };
    }
    return this.toDayDto(day);
  }

  async upsert(
    user: AuthUser,
    shopId: string,
    businessDate: string,
    dto: UpsertTipDayInput,
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertTipsEnabled(shopId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      throw new BadRequestException('Fecha inválida');
    }

    const cash = Math.max(0, n(dto.cashAmount));
    const transfer = Math.max(0, n(dto.transferAmount));
    const tickets = Math.max(0, n(dto.ticketsAmount));
    const total = round2(cash + transfer + tickets);

    const allocInputs = dto.allocations ?? [];
    if (allocInputs.length) {
      const sum = round2(allocInputs.reduce((s, a) => s + Math.max(0, n(a.amount)), 0));
      if (Math.abs(sum - total) > 0.02) {
        throw new BadRequestException(
          `La suma del reparto ($${sum.toFixed(2)}) debe igualar el total ($${total.toFixed(2)})`,
        );
      }
      const empIds = [...new Set(allocInputs.map((a) => a.employeeId))];
      const emps = await this.employees.find({
        where: { shopId, id: In(empIds), active: true },
      });
      if (emps.length !== empIds.length) {
        throw new BadRequestException('Hay empleados inválidos o inactivos en el reparto');
      }
    }

    let day = await this.tipDays.findOne({
      where: { shopId, businessDate },
      withDeleted: true,
    });
    if (!day) {
      day = this.tipDays.create({
        shopId,
        businessDate,
        createdByUserId: user.id,
        active: true,
      });
    } else {
      day.deletedAt = null as any;
      day.active = true;
    }

    day.cashAmount = money(cash);
    day.transferAmount = money(transfer);
    day.ticketsAmount = money(tickets);
    day.totalAmount = money(total);
    if (dto.notes !== undefined) day.notes = dto.notes?.trim() || null;
    if (dto.closingId !== undefined) day.closingId = dto.closingId || null;
    await this.tipDays.save(day);

    if (dto.allocations !== undefined) {
      const existing = await this.allocations.find({
        where: { tipDayId: day.id },
        withDeleted: true,
      });
      const byEmp = new Map(existing.map((a) => [a.employeeId, a]));
      const keep = new Set(allocInputs.map((a) => a.employeeId));

      for (const input of allocInputs) {
        let row = byEmp.get(input.employeeId);
        const amount = money(Math.max(0, n(input.amount)));
        if (!row) {
          row = this.allocations.create({
            tipDayId: day.id,
            employeeId: input.employeeId,
            amount,
            delivered: !!input.delivered,
            deliveredAt: input.delivered ? new Date() : null,
            deliveredByUserId: input.delivered ? user.id : null,
            active: true,
          });
        } else {
          row.deletedAt = null as any;
          row.active = true;
          row.amount = amount;
          if (input.delivered !== undefined) {
            const next = !!input.delivered;
            if (next && !row.delivered) {
              row.delivered = true;
              row.deliveredAt = new Date();
              row.deliveredByUserId = user.id;
            } else if (!next && row.delivered) {
              row.delivered = false;
              row.deliveredAt = null;
              row.deliveredByUserId = null;
            }
          }
        }
        await this.allocations.save(row);
      }

      for (const row of existing) {
        if (!keep.has(row.employeeId) && isEntityActive(row.active) && !row.deletedAt) {
          row.active = false;
          await this.allocations.softRemove(row);
        }
      }
    }

    // Sync tipsAmount on closing of same day if linked or found
    await this.syncClosingTipsAmount(shopId, businessDate, total, day);

    return this.getByDate(user, shopId, businessDate);
  }

  /** Sync desde cierre: montos + tipAmount total. */
  async syncFromClosing(
    user: AuthUser,
    shopId: string,
    businessDate: string,
    input: UpsertTipDayInput & { tipsAmount?: number },
  ) {
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop?.tipsEnabled) return null;

    const hasBreakdown =
      input.cashAmount != null ||
      input.transferAmount != null ||
      input.ticketsAmount != null ||
      (input.allocations && input.allocations.length > 0);

    if (hasBreakdown) {
      const cash = Math.max(0, n(input.cashAmount));
      const transfer = Math.max(0, n(input.transferAmount));
      const tickets = Math.max(0, n(input.ticketsAmount));
      let total = round2(cash + transfer + tickets);
      if (total <= 0 && input.tipsAmount != null) {
        return this.upsert(user, shopId, businessDate, {
          cashAmount: n(input.tipsAmount),
          transferAmount: 0,
          ticketsAmount: 0,
          notes: input.notes,
          closingId: input.closingId,
          allocations: input.allocations,
        });
      }
      return this.upsert(user, shopId, businessDate, {
        cashAmount: cash,
        transferAmount: transfer,
        ticketsAmount: tickets,
        notes: input.notes,
        closingId: input.closingId,
        allocations: input.allocations,
      });
    }

    if (input.tipsAmount == null) return null;
    const existing = await this.tipDays.findOne({
      where: { shopId, businessDate, active: true },
      relations: ['allocations'],
    });
    if (existing) {
      const ratio =
        n(existing.totalAmount) > 0 ? n(input.tipsAmount) / n(existing.totalAmount) : 1;
      const cash = round2(n(existing.cashAmount) * ratio);
      const transfer = round2(n(existing.transferAmount) * ratio);
      const tickets = round2(n(input.tipsAmount) - cash - transfer);
      return this.upsert(user, shopId, businessDate, {
        cashAmount: cash,
        transferAmount: transfer,
        ticketsAmount: Math.max(0, tickets),
        closingId: input.closingId ?? existing.closingId,
        allocations: (existing.allocations ?? []).map((a) => ({
          employeeId: a.employeeId,
          amount: round2(n(a.amount) * ratio),
          delivered: !!a.delivered,
        })),
      });
    }
    return this.upsert(user, shopId, businessDate, {
      cashAmount: n(input.tipsAmount),
      transferAmount: 0,
      ticketsAmount: 0,
      closingId: input.closingId,
      allocations: [],
    });
  }

  private async syncClosingTipsAmount(
    shopId: string,
    businessDate: string,
    total: number,
    day: TipDay,
  ) {
    const closing = await this.closings.findOne({
      where: { shopId, businessDate, active: true },
      order: { createdAt: 'DESC' },
    });
    if (!closing) return;
    closing.tipsAmount = money(total);
    await this.closings.save(closing);
    if (!day.closingId) {
      day.closingId = closing.id;
      await this.tipDays.save(day);
    }
  }

  async setDelivered(
    user: AuthUser,
    shopId: string,
    businessDate: string,
    allocationId: string,
    delivered: boolean,
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertTipsEnabled(shopId);
    const day = await this.tipDays.findOne({
      where: { shopId, businessDate, active: true },
    });
    if (!day) throw new NotFoundException('Día de propinas no encontrado');
    const row = await this.allocations.findOne({
      where: { id: allocationId, tipDayId: day.id, active: true },
      relations: ['employee'],
    });
    if (!row) throw new NotFoundException('Asignación no encontrada');
    row.delivered = !!delivered;
    row.deliveredAt = delivered ? new Date() : null;
    row.deliveredByUserId = delivered ? user.id : null;
    await this.allocations.save(row);
    return this.toAllocationDto(row);
  }

  async pendingCount(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop?.tipsEnabled) return { count: 0 };
    const days = await this.tipDays.find({
      where: { shopId, active: true },
      select: ['id'],
    });
    if (!days.length) return { count: 0 };
    const count = await this.allocations.count({
      where: {
        tipDayId: In(days.map((d) => d.id)),
        delivered: false,
        active: true,
      },
    });
    return { count };
  }

  async summary(user: AuthUser, shopId: string, from: string, to: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop?.tipsEnabled) {
      return {
        enabled: false,
        totals: {
          cash: 0,
          transfer: 0,
          tickets: 0,
          total: 0,
          pendingCount: 0,
          allocationCount: 0,
          avgPerEmployee: 0,
        },
        byDay: [],
        byEmployee: [],
      };
    }

    const days = await this.tipDays.find({
      where: { shopId, businessDate: Between(from, to), active: true },
      relations: ['allocations', 'allocations.employee'],
      order: { businessDate: 'ASC' },
    });

    let cash = 0;
    let transfer = 0;
    let tickets = 0;
    let total = 0;
    let pendingCount = 0;
    let allocationCount = 0;
    const byEmployee = new Map<
      string,
      { employeeId: string; employeeName: string; amount: number; pendingAmount: number }
    >();

    const byDay = days.map((d) => {
      cash += n(d.cashAmount);
      transfer += n(d.transferAmount);
      tickets += n(d.ticketsAmount);
      total += n(d.totalAmount);
      let dayPending = 0;
      for (const a of d.allocations ?? []) {
        allocationCount += 1;
        const amt = n(a.amount);
        if (!a.delivered) {
          pendingCount += 1;
          dayPending += 1;
        }
        const cur = byEmployee.get(a.employeeId) ?? {
          employeeId: a.employeeId,
          employeeName: a.employee?.fullName ?? '—',
          amount: 0,
          pendingAmount: 0,
        };
        cur.amount += amt;
        if (!a.delivered) cur.pendingAmount += amt;
        byEmployee.set(a.employeeId, cur);
      }
      return {
        businessDate: String(d.businessDate).slice(0, 10),
        cashAmount: n(d.cashAmount),
        transferAmount: n(d.transferAmount),
        ticketsAmount: n(d.ticketsAmount),
        totalAmount: n(d.totalAmount),
        pendingCount: dayPending,
        employeeCount: (d.allocations ?? []).length,
      };
    });

    const empRows = [...byEmployee.values()].sort((a, b) => b.amount - a.amount);
    const avgPerEmployee =
      empRows.length > 0 ? round2(total / empRows.length) : 0;

    return {
      enabled: true,
      totals: {
        cash: round2(cash),
        transfer: round2(transfer),
        tickets: round2(tickets),
        total: round2(total),
        pendingCount,
        allocationCount,
        avgPerEmployee,
      },
      byDay,
      byEmployee: empRows,
    };
  }
}
