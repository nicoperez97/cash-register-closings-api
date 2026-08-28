import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingSourceAmount } from '../../entities/closing-source-amount.entity';
import { CashPendingWithdrawal } from '../../entities/cash-pending-withdrawal.entity';
import { Payment } from '../../entities/payment.entity';
import { TipDay } from '../../entities/tip-day.entity';
import { TipAllocation } from '../../entities/tip-allocation.entity';
import { Reimbursement } from '../../entities/reimbursement.entity';
import { Order } from '../../entities/order.entity';
import { PosSaleImport } from '../../entities/pos-sale-import.entity';
import { PartnerSplitRun } from '../../entities/partner-split-run.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { PaymentStatus } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';

export const USER_ACTIVITY_WEIGHTS = {
  closings: 10,
  settlements: 10,
  withdrawalsPicked: 5,
  withdrawalsConfirmed: 5,
  paymentsCreated: 5,
  paymentsValidated: 8,
  paymentsPaid: 8,
  tipsLoaded: 5,
  tipsDelivered: 5,
  reimbursementsCreated: 5,
  reimbursementsPaid: 8,
  orders: 3,
  posImports: 5,
  partnerSplits: 10,
} as const;

export type UserActivityBreakdown = Record<keyof typeof USER_ACTIVITY_WEIGHTS, number>;

export type UserActivityRow = {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  hasAvatar: boolean;
  rank: number;
  score: number;
  totalActions: number;
  lastActionAt: string | null;
  breakdown: UserActivityBreakdown;
};

type CountAgg = { count: number; lastAt: Date | null };

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

function rangeBounds(from: string, to: string): { fromDt: Date; toDt: Date } {
  return {
    fromDt: new Date(`${from}T00:00:00.000Z`),
    toDt: new Date(`${to}T23:59:59.999Z`),
  };
}

function emptyBreakdown(): UserActivityBreakdown {
  return {
    closings: 0,
    settlements: 0,
    withdrawalsPicked: 0,
    withdrawalsConfirmed: 0,
    paymentsCreated: 0,
    paymentsValidated: 0,
    paymentsPaid: 0,
    tipsLoaded: 0,
    tipsDelivered: 0,
    reimbursementsCreated: 0,
    reimbursementsPaid: 0,
    orders: 0,
    posImports: 0,
    partnerSplits: 0,
  };
}

@Injectable()
export class UserActivityService {
  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(ClosingSourceAmount)
    private readonly settlements: Repository<ClosingSourceAmount>,
    @InjectRepository(CashPendingWithdrawal)
    private readonly withdrawals: Repository<CashPendingWithdrawal>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(TipDay) private readonly tipDays: Repository<TipDay>,
    @InjectRepository(TipAllocation) private readonly tipAllocations: Repository<TipAllocation>,
    @InjectRepository(Reimbursement) private readonly reimbursements: Repository<Reimbursement>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(PosSaleImport) private readonly posImports: Repository<PosSaleImport>,
    @InjectRepository(PartnerSplitRun) private readonly partnerSplits: Repository<PartnerSplitRun>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
  ) {}

  async ranking(user: AuthUser, shopId: string, filters?: { from?: string; to?: string }) {
    this.shops.assertShopAccess(user, shopId);
    const range = filters?.from && filters?.to ? filters : defaultRange();
    const from = range.from!;
    const to = range.to!;
    const { fromDt, toDt } = rangeBounds(from, to);

    const [
      closings,
      settlements,
      picked,
      confirmed,
      paymentsCreated,
      paymentsValidated,
      paymentsPaid,
      tipsLoaded,
      tipsDelivered,
      reimbursementsCreated,
      reimbursementsPaid,
      orders,
      posImports,
      partnerSplits,
      shopUserIds,
    ] = await Promise.all([
      this.countByUser(this.closings, 'c', 'shopId', shopId, 'createdByUserId', 'createdAt', fromDt, toDt),
      this.countSettlements(shopId, fromDt, toDt),
      this.countByUser(this.withdrawals, 'w', 'shopId', shopId, 'pickedByUserId', 'updatedAt', fromDt, toDt, 'w.pickedByUserId IS NOT NULL'),
      this.countByUser(this.withdrawals, 'w', 'shopId', shopId, 'confirmedByUserId', 'updatedAt', fromDt, toDt, 'w.confirmedByUserId IS NOT NULL'),
      this.countByUser(this.payments, 'p', 'shopId', shopId, 'createdByUserId', 'createdAt', fromDt, toDt),
      this.countByUser(this.payments, 'p', 'shopId', shopId, 'validatedByUserId', 'validatedAt', fromDt, toDt, 'p.validatedByUserId IS NOT NULL'),
      this.countPaymentsPaid(shopId, fromDt, toDt),
      this.countByUser(this.tipDays, 't', 'shopId', shopId, 'createdByUserId', 'createdAt', fromDt, toDt),
      this.countTipsDelivered(shopId, fromDt, toDt),
      this.countByUser(this.reimbursements, 'r', 'shopId', shopId, 'createdByUserId', 'createdAt', fromDt, toDt),
      this.countByUser(this.reimbursements, 'r', 'shopId', shopId, 'paidByUserId', 'updatedAt', fromDt, toDt, 'r.paidByUserId IS NOT NULL'),
      this.countByUser(this.orders, 'o', 'shopId', shopId, 'createdByUserId', 'createdAt', fromDt, toDt),
      this.countByUser(this.posImports, 'i', 'shopId', shopId, 'importedByUserId', 'createdAt', fromDt, toDt),
      this.countByUser(this.partnerSplits, 's', 'shopId', shopId, 'appliedByUserId', 'appliedAt', fromDt, toDt),
      this.loadShopUserIds(shopId),
    ]);

    const breakdowns = new Map<string, UserActivityBreakdown>();
    const lastByUser = new Map<string, Date>();

    const merge = (
      map: Map<string, CountAgg>,
      key: keyof UserActivityBreakdown,
    ) => {
      for (const [userId, agg] of map) {
        if (!agg.count) continue;
        const row = breakdowns.get(userId) ?? emptyBreakdown();
        row[key] = agg.count;
        breakdowns.set(userId, row);
        if (agg.lastAt) {
          const prev = lastByUser.get(userId);
          if (!prev || agg.lastAt > prev) lastByUser.set(userId, agg.lastAt);
        }
      }
    };

    merge(closings, 'closings');
    merge(settlements, 'settlements');
    merge(picked, 'withdrawalsPicked');
    merge(confirmed, 'withdrawalsConfirmed');
    merge(paymentsCreated, 'paymentsCreated');
    merge(paymentsValidated, 'paymentsValidated');
    merge(paymentsPaid, 'paymentsPaid');
    merge(tipsLoaded, 'tipsLoaded');
    merge(tipsDelivered, 'tipsDelivered');
    merge(reimbursementsCreated, 'reimbursementsCreated');
    merge(reimbursementsPaid, 'reimbursementsPaid');
    merge(orders, 'orders');
    merge(posImports, 'posImports');
    merge(partnerSplits, 'partnerSplits');

    const userIds = [...new Set([...shopUserIds, ...breakdowns.keys()])];
    const userRows = userIds.length
      ? await this.users.find({ where: { id: In(userIds) } })
      : [];
    const userById = new Map(userRows.map((u) => [u.id, u]));

    const ranking: UserActivityRow[] = userIds.map((userId) => {
      const breakdown = breakdowns.get(userId) ?? emptyBreakdown();
      const totalActions = Object.values(breakdown).reduce((s, n) => s + n, 0);
      const score = (
        Object.keys(USER_ACTIVITY_WEIGHTS) as Array<keyof typeof USER_ACTIVITY_WEIGHTS>
      ).reduce((s, k) => s + breakdown[k] * USER_ACTIVITY_WEIGHTS[k], 0);
      const u = userById.get(userId);
      const last = lastByUser.get(userId);
      return {
        userId,
        fullName: u?.fullName?.trim() || u?.email || 'Usuario',
        email: u?.email ?? '',
        avatarUrl: u?.avatarUrl ?? null,
        hasAvatar: !!u?.avatarUrl,
        rank: 0,
        score,
        totalActions,
        lastActionAt: last ? last.toISOString() : null,
        breakdown,
      };
    });

    ranking.sort((a, b) => b.score - a.score || b.totalActions - a.totalActions || a.fullName.localeCompare(b.fullName, 'es'));
    ranking.forEach((row, i) => {
      row.rank = i + 1;
    });

    const activeUsers = ranking.filter((r) => r.score > 0).length;
    const totalActions = ranking.reduce((s, r) => s + r.totalActions, 0);

    return {
      shopId,
      from,
      to,
      weights: USER_ACTIVITY_WEIGHTS,
      totals: {
        users: ranking.length,
        activeUsers,
        totalActions,
        totalScore: ranking.reduce((s, r) => s + r.score, 0),
      },
      ranking,
    };
  }

  private async loadShopUserIds(shopId: string): Promise<string[]> {
    const links = await this.userShops.find({ where: { shopId } });
    return links.map((l) => l.userId);
  }

  private async countByUser(
    repo: Repository<any>,
    alias: string,
    shopCol: string,
    shopId: string,
    userCol: string,
    dateCol: string,
    fromDt: Date,
    toDt: Date,
    extraWhere?: string,
  ): Promise<Map<string, CountAgg>> {
    const qb = repo
      .createQueryBuilder(alias)
      .select(`${alias}.${userCol}`, 'userId')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect(`MAX(${alias}.${dateCol})`, 'lastAt')
      .where(`${alias}.${shopCol} = :shopId`, { shopId })
      .andWhere(`${alias}.${userCol} IS NOT NULL`)
      .andWhere(`${alias}.${dateCol} BETWEEN :fromDt AND :toDt`, { fromDt, toDt });
    if (extraWhere) qb.andWhere(extraWhere);
    if (repo.metadata.columns.some((c) => c.propertyName === 'active')) {
      qb.andWhere(`${alias}.active = true`);
    }
    const rows = await qb.groupBy(`${alias}.${userCol}`).getRawMany();
    return new Map(
      rows.map((r) => [
        String(r.userId),
        { count: Number(r.cnt ?? 0), lastAt: r.lastAt ? new Date(r.lastAt) : null },
      ]),
    );
  }

  private async countSettlements(
    shopId: string,
    fromDt: Date,
    toDt: Date,
  ): Promise<Map<string, CountAgg>> {
    const rows = await this.settlements
      .createQueryBuilder('csa')
      .innerJoin('csa.closing', 'c')
      .select('csa.settledByUserId', 'userId')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('MAX(csa.settledAt)', 'lastAt')
      .where('c.shopId = :shopId', { shopId })
      .andWhere('csa.settledByUserId IS NOT NULL')
      .andWhere('csa.settledAt BETWEEN :fromDt AND :toDt', { fromDt, toDt })
      .groupBy('csa.settledByUserId')
      .getRawMany();
    return new Map(
      rows.map((r) => [
        String(r.userId),
        { count: Number(r.cnt ?? 0), lastAt: r.lastAt ? new Date(r.lastAt) : null },
      ]),
    );
  }

  private async countTipsDelivered(
    shopId: string,
    fromDt: Date,
    toDt: Date,
  ): Promise<Map<string, CountAgg>> {
    const rows = await this.tipAllocations
      .createQueryBuilder('ta')
      .innerJoin('ta.tipDay', 'td')
      .select('ta.deliveredByUserId', 'userId')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('MAX(ta.deliveredAt)', 'lastAt')
      .where('td.shopId = :shopId', { shopId })
      .andWhere('ta.deliveredByUserId IS NOT NULL')
      .andWhere('ta.deliveredAt BETWEEN :fromDt AND :toDt', { fromDt, toDt })
      .groupBy('ta.deliveredByUserId')
      .getRawMany();
    return new Map(
      rows.map((r) => [
        String(r.userId),
        { count: Number(r.cnt ?? 0), lastAt: r.lastAt ? new Date(r.lastAt) : null },
      ]),
    );
  }

  private async countPaymentsPaid(
    shopId: string,
    fromDt: Date,
    toDt: Date,
  ): Promise<Map<string, CountAgg>> {
    const rows = await this.payments
      .createQueryBuilder('p')
      .select('p.payerUserId', 'userId')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('MAX(p.paidAt)', 'lastAt')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.active = true')
      .andWhere('p.status = :st', { st: PaymentStatus.PAID })
      .andWhere('p.payerUserId IS NOT NULL')
      .andWhere('p.paidAt IS NOT NULL')
      .andWhere('p.paidAt BETWEEN :from AND :to', {
        from: fromDt.toISOString().slice(0, 10),
        to: toDt.toISOString().slice(0, 10),
      })
      .groupBy('p.payerUserId')
      .getRawMany();
    return new Map(
      rows.map((r) => [
        String(r.userId),
        {
          count: Number(r.cnt ?? 0),
          lastAt: r.lastAt ? new Date(`${r.lastAt}T12:00:00.000Z`) : null,
        },
      ]),
    );
  }
}
