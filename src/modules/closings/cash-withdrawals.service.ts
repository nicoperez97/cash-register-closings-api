import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { CashPendingWithdrawal } from '../../entities/cash-pending-withdrawal.entity';
import { CashPendingWithdrawalOffset } from '../../entities/cash-pending-withdrawal-offset.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { AccountsService } from '../accounts/accounts.service';
import { ClosingMovementsSyncService } from '../movements/closing-movements-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { AuthUser } from '../../common/decorators';
import {
  CashPendingWithdrawalStatus,
  ConceptKind,
  GlobalRole,
  LinkedPaymentMethod,
  NotificationType,
} from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { PickCashWithdrawalsDto } from './dto/cash-withdrawal.dto';

const n = (v?: number | string | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class CashWithdrawalsService implements OnModuleInit {
  private readonly logger = new Logger(CashWithdrawalsService.name);

  constructor(
    @InjectRepository(CashPendingWithdrawal)
    private readonly pending: Repository<CashPendingWithdrawal>,
    @InjectRepository(CashPendingWithdrawalOffset)
    private readonly offsets: Repository<CashPendingWithdrawalOffset>,
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    @InjectRepository(LedgerAccount)
    private readonly ledger: Repository<LedgerAccount>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(Shop) private readonly shopRepo: Repository<Shop>,
    private readonly shops: ShopsService,
    private readonly accounts: AccountsService,
    private readonly closingMovements: ClosingMovementsSyncService,
    private readonly notifications: NotificationsService,
    private readonly live: ShopLiveService,
  ) {}

  async onModuleInit() {
    for (const sql of [
      `ALTER TABLE cash_pending_withdrawals ADD COLUMN pickBatchId VARCHAR(36) NULL`,
      `ALTER TABLE cash_pending_withdrawals ADD COLUMN confirmedByUserId VARCHAR(36) NULL`,
      `ALTER TABLE cash_pending_withdrawals ADD COLUMN confirmedByName VARCHAR(200) NULL`,
      `CREATE TABLE IF NOT EXISTS cash_pending_withdrawal_offsets (
        id VARCHAR(36) NOT NULL,
        shopId VARCHAR(36) NOT NULL,
        pendingId VARCHAR(36) NOT NULL,
        movementId VARCHAR(36) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_cash_wd_offsets_pending_movement (pendingId, movementId),
        KEY IDX_cash_wd_offsets_pending (pendingId),
        KEY IDX_cash_wd_offsets_movement (movementId)
      )`,
    ]) {
      try {
        await this.pending.query(sql);
      } catch {
        // ya existe
      }
    }
  }

  /** Monto a retirar según reglas del cierre (retiro explícito o efectivo − cambio − egresos). */
  computeCashTake(closing: CashClosing): number {
    const expensesTotal = (closing.expenses ?? []).reduce((s, e) => s + n(e.amount), 0);
    if (n(closing.cashWithdrawn) > 0) return n(closing.cashWithdrawn);
    return Math.max(0, n(closing.cashAmount) - n(closing.cashLeftInRegister));
  }

  /**
   * Tras guardar un cierre: crea/actualiza pendiente si no hay destinatario y hay monto;
   * cancela el pendiente si ya hay quién o el monto es 0.
   */
  async syncFromClosing(closing: CashClosing): Promise<void> {
    const hasWho = !!(closing.cashWithdrawnByUserId || closing.cashWithdrawnByEmployeeId);
    const amount = this.computeCashTake(closing);
    const existing = await this.pending.findOne({
      where: {
        closingId: closing.id,
        status: CashPendingWithdrawalStatus.PENDING,
        active: true,
      },
    });

    if (hasWho || amount <= 0) {
      if (existing) {
        existing.active = false;
        await this.pending.save(existing);
        await this.pending.softRemove(existing);
      }
      if (!hasWho && n(closing.cashPendingPickup) !== 0) {
        closing.cashPendingPickup = money(0);
        await this.closings.save(closing);
      }
      return;
    }

    if (existing) {
      existing.amount = money(amount);
      existing.businessDate = closing.businessDate;
      await this.pending.save(existing);
    } else {
      await this.pending.save(
        this.pending.create({
          shopId: closing.shopId,
          closingId: closing.id,
          businessDate: closing.businessDate,
          amount: money(amount),
          status: CashPendingWithdrawalStatus.PENDING,
          active: true,
        }),
      );
    }

    if (n(closing.cashPendingPickup) !== amount) {
      closing.cashPendingPickup = money(amount);
      await this.closings.save(closing);
    }
    this.live.tick(closing.shopId, 'inbox');
  }

  async cancelForClosing(closingId: string): Promise<void> {
    const rows = await this.pending.find({
      where: {
        closingId,
        status: CashPendingWithdrawalStatus.PENDING,
        active: true,
      },
    });
    for (const row of rows) {
      row.active = false;
      await this.pending.save(row);
      await this.pending.softRemove(row);
    }
  }

  async listPending(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const view = await this.computePendingView(shopId);
    return {
      items: view.items
        .filter((i) => i.remainingAmount > 0.009)
        .sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate)))
        .map((i) => ({
          id: i.id,
          shopId: i.shopId,
          closingId: i.closingId,
          businessDate: i.businessDate,
          amount: i.remainingAmount,
          originalAmount: i.originalAmount,
          deductedAmount: i.deductedAmount,
          status: i.status,
          createdAt: i.createdAt,
        })),
      covered: view.items
        .filter((i) => i.remainingAmount <= 0.009)
        .sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate)))
        .map((i) => ({
          id: i.id,
          closingId: i.closingId,
          businessDate: i.businessDate,
          originalAmount: i.originalAmount,
          deductedAmount: i.deductedAmount,
        })),
      cashExpenses: view.cashExpenses,
      expensesTotal: view.expensesTotal,
      availableTotal: view.availableTotal,
    };
  }

  async listHistory(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.pending.find({
      where: {
        shopId,
        status: CashPendingWithdrawalStatus.PICKED,
        active: true,
        pickedAt: Not(IsNull()),
      },
      relations: ['pickedToAccount'],
      order: { pickedAt: 'DESC', businessDate: 'DESC' },
      take: 400,
    });

    type Group = {
      id: string;
      pickedAt: string;
      pickedByUserId: string | null;
      pickedByName: string;
      accountId: string | null;
      accountName: string | null;
      confirmedByUserId: string | null;
      confirmedByName: string | null;
      totalAmount: number;
      closingsCount: number;
      items: Array<{
        id: string;
        closingId: string;
        businessDate: string;
        amount: number;
      }>;
    };

    const groups = new Map<string, Group>();
    for (const r of rows) {
      const pickedAtIso = r.pickedAt ? new Date(r.pickedAt).toISOString() : '';
      const key =
        r.pickBatchId ||
        [pickedAtIso, r.pickedByUserId ?? '', r.pickedToAccountId ?? ''].join('|');
      const existing = groups.get(key);
      const item = {
        id: r.id,
        closingId: r.closingId,
        businessDate: r.businessDate,
        amount: n(r.amount),
      };
      if (existing) {
        existing.items.push(item);
        existing.totalAmount += item.amount;
        existing.closingsCount += 1;
        continue;
      }
      groups.set(key, {
        id: r.pickBatchId || r.id,
        pickedAt: pickedAtIso,
        pickedByUserId: r.pickedByUserId ?? null,
        pickedByName: r.pickedByName?.trim() || 'Sin asignar',
        accountId: r.pickedToAccountId ?? null,
        accountName: r.pickedToAccount?.name ?? null,
        confirmedByUserId: r.confirmedByUserId ?? null,
        confirmedByName: r.confirmedByName ?? null,
        totalAmount: item.amount,
        closingsCount: 1,
        items: [item],
      });
    }

    return [...groups.values()].map((g) => ({
      ...g,
      items: g.items.sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate))),
    }));
  }

  async pick(user: AuthUser, shopId: string, dto: PickCashWithdrawalsDto) {
    this.shops.assertShopAccess(user, shopId);
    const ids = [...new Set(dto.ids)];
    const rows = await this.pending.find({
      where: {
        id: In(ids),
        shopId,
        status: CashPendingWithdrawalStatus.PENDING,
        active: true,
      },
    });
    if (rows.length !== ids.length) {
      throw new NotFoundException('Uno o más retiros pendientes no existen o ya fueron retirados');
    }

    const picker = await this.users.findOne({ where: { id: dto.userId, active: true } });
    if (!picker) throw new BadRequestException('Usuario no encontrado');

    const membership = await this.userShops.findOne({
      where: { shopId, userId: dto.userId },
    });
    if (!membership) {
      throw new BadRequestException('El usuario no pertenece a este local');
    }

    const account = await this.accounts.resolvePartnerAccountForUser(
      shopId,
      dto.userId,
      dto.accountId,
    );

    const view = await this.computePendingView(shopId, { purgeStaleOffsets: true });
    const byId = new Map(view.items.map((i) => [i.id, i]));
    for (const row of rows) {
      if (!byId.has(row.id)) {
        throw new NotFoundException('Uno o más retiros pendientes no existen o ya fueron retirados');
      }
    }

    const toPick = rows.filter((r) => (byId.get(r.id)?.remainingAmount ?? 0) > 0.009);
    if (!toPick.length) {
      throw new BadRequestException(
        'No queda efectivo para retirar: ya se usó en gastos de caja',
      );
    }

    const now = new Date();
    const pickBatchId = randomUUID();
    const confirmedByName = actorDisplayName(user);
    let totalAmount = 0;
    for (const row of toPick) {
      const computed = byId.get(row.id)!;
      const take = computed.remainingAmount;
      const closing = await this.closings.findOne({
        where: { id: row.closingId, shopId, active: true },
        relations: ['expenses', 'extraLines'],
      });
      if (!closing) {
        throw new NotFoundException(`Cierre del retiro ${row.id} no encontrado`);
      }

      closing.cashWithdrawnByUserId = picker.id;
      closing.cashWithdrawnByName = picker.fullName;
      closing.cashWithdrawnByEmployeeId = null;
      closing.cashWithdrawnToAccountId = account.id;
      closing.cashPendingPickup = money(0);
      if (!(n(closing.cashWithdrawn) > 0)) {
        closing.cashWithdrawn = money(take);
      }
      await this.closings.save(closing);
      await this.closingMovements.syncFromClosing(closing);

      row.status = CashPendingWithdrawalStatus.PICKED;
      row.amount = money(take);
      row.pickedByUserId = picker.id;
      row.pickedByName = picker.fullName;
      row.pickedToAccountId = account.id;
      row.pickedAt = now;
      row.pickBatchId = pickBatchId;
      row.confirmedByUserId = user.id;
      row.confirmedByName = confirmedByName;
      await this.pending.save(row);
      for (const alloc of computed.allocations) {
        const exists = await this.offsets.findOne({
          where: { pendingId: row.id, movementId: alloc.movementId },
        });
        if (exists) continue;
        await this.offsets.save(
          this.offsets.create({
            shopId,
            pendingId: row.id,
            movementId: alloc.movementId,
            amount: money(alloc.amount),
          }),
        );
      }
      totalAmount += take;
    }

    void this.notifyAdminsWithdrawalPicked(user, shopId, {
      count: toPick.length,
      totalAmount,
      pickedByName: picker.fullName,
      accountName: account.name,
      closingId: toPick.length === 1 ? toPick[0].closingId : null,
    }).catch((err) => {
      this.logger.warn(
        `No se pudo notificar retiro: ${(err as Error)?.message ?? err}`,
      );
    });

    this.live.tick(shopId, 'inbox');
    return { ok: true, picked: toPick.length, pickBatchId };
  }

  async pendingCount(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const view = await this.computePendingView(shopId, { includeExpenses: false });
    const count = view.items.filter((i) => i.remainingAmount > 0.009).length;
    return { count };
  }

  /**
   * Resta gastos de caja (movimientos desde Efectivo, sin cierre) a los pendientes.
   * FIFO: el gasto se imputa al retiro más viejo que ya existía cuando se registró.
   */
  private async computePendingView(
    shopId: string,
    opts?: { includeExpenses?: boolean; purgeStaleOffsets?: boolean },
  ) {
    const pending = await this.pending.find({
      where: {
        shopId,
        status: CashPendingWithdrawalStatus.PENDING,
        active: true,
      },
      order: { businessDate: 'ASC', createdAt: 'ASC' },
    });

    const savedOffsets = await this.offsets.find({ where: { shopId } });
    const cashIds = await this.cashDrawerAccountIds(shopId);
    const egreso = cashIds.length
      ? await this.ledger.findOne({ where: { shopId, code: 'EGRESO', active: true } })
      : null;
    const offsetMovementIds = [...new Set(savedOffsets.map((o) => o.movementId))];
    const offsetMovements = offsetMovementIds.length
      ? await this.movements.find({
          where: { id: In(offsetMovementIds), shopId },
          relations: ['concept'],
        })
      : [];
    const validOffsetMovementIds = new Set(
      offsetMovements
        .filter((m) => this.isCashDrawerExpense(m, cashIds, egreso?.id ?? null))
        .map((m) => m.id),
    );
    const staleOffsets = savedOffsets.filter((o) => !validOffsetMovementIds.has(o.movementId));
    if (opts?.purgeStaleOffsets && staleOffsets.length) {
      await this.offsets.remove(staleOffsets);
    }
    const liveOffsets = savedOffsets.filter((o) => validOffsetMovementIds.has(o.movementId));
    const usedByMovement = new Map<string, number>();
    const usedByPending = new Map<string, number>();
    for (const o of liveOffsets) {
      usedByMovement.set(o.movementId, (usedByMovement.get(o.movementId) ?? 0) + n(o.amount));
      usedByPending.set(o.pendingId, (usedByPending.get(o.pendingId) ?? 0) + n(o.amount));
    }

    type Item = {
      id: string;
      shopId: string;
      closingId: string;
      businessDate: string;
      status: string;
      createdAt: Date;
      originalAmount: number;
      deductedAmount: number;
      remainingAmount: number;
      allocations: Array<{ movementId: string; amount: number }>;
    };

    const items: Item[] = pending.map((r) => {
      const originalAmount = n(r.amount);
      const already = usedByPending.get(r.id) ?? 0;
      const remainingAmount = Math.max(0, Math.round((originalAmount - already) * 100) / 100);
      return {
        id: r.id,
        shopId: r.shopId,
        closingId: r.closingId,
        businessDate: r.businessDate,
        status: r.status,
        createdAt: r.createdAt,
        originalAmount,
        deductedAmount: Math.min(originalAmount, already),
        remainingAmount,
        allocations: [],
      };
    });

    const applied = new Map<string, number>();
    const pendingIds = new Set(items.map((i) => i.id));
    for (const o of liveOffsets) {
      if (!pendingIds.has(o.pendingId)) continue;
      applied.set(o.movementId, (applied.get(o.movementId) ?? 0) + n(o.amount));
    }

    if (cashIds.length && items.length) {
      const oldest = items.reduce(
        (min, i) => (i.createdAt < min ? i.createdAt : min),
        items[0].createdAt,
      );
      const movements = await this.movements
        .createQueryBuilder('m')
        .leftJoinAndSelect('m.concept', 'concept')
        .where('m.shopId = :shopId', { shopId })
        .andWhere('m.active = true')
        .andWhere('m.closingId IS NULL')
        .andWhere('m.fromAccountId IN (:...cashIds)', { cashIds })
        .andWhere('m.createdAt >= :oldest', { oldest })
        .orderBy('m.createdAt', 'ASC')
        .getMany();

      for (const m of movements) {
        if (!this.isCashDrawerExpense(m, cashIds, egreso?.id ?? null)) continue;
        let left = n(m.amountUyu) - (usedByMovement.get(m.id) ?? 0);
        if (left <= 0.009) continue;
        for (const item of items) {
          if (left <= 0.009) break;
          if (item.createdAt.getTime() > m.createdAt.getTime()) continue;
          if (item.remainingAmount <= 0.009) continue;
          const take = Math.min(item.remainingAmount, left);
          item.remainingAmount = Math.round((item.remainingAmount - take) * 100) / 100;
          item.deductedAmount = Math.round((item.deductedAmount + take) * 100) / 100;
          item.allocations.push({ movementId: m.id, amount: take });
          applied.set(m.id, (applied.get(m.id) ?? 0) + take);
          left = Math.round((left - take) * 100) / 100;
        }
      }
    }

    const availableTotal = items.reduce((s, i) => s + Math.max(0, i.remainingAmount), 0);
    if (opts?.includeExpenses === false) {
      return { items, cashExpenses: [], expensesTotal: 0, availableTotal };
    }

    const expenseIds = [...applied.entries()]
      .filter(([, amount]) => amount > 0.009)
      .map(([id]) => id);
    const expenseRows = expenseIds.length
      ? await this.movements.find({
          where: { id: In(expenseIds) },
          relations: ['concept'],
        })
      : [];
    const byExpId = new Map(expenseRows.map((m) => [m.id, m]));
    const cashExpenses = expenseIds.map((id) => {
      const m = byExpId.get(id);
      return {
        id,
        businessDate: m?.businessDate ?? '',
        description: m?.description ?? null,
        conceptName: m?.concept?.name ?? null,
        amount: Math.round((applied.get(id) ?? 0) * 100) / 100,
      };
    });

    const expensesTotal = cashExpenses.reduce((s, e) => s + e.amount, 0);
    return { items, cashExpenses, expensesTotal, availableTotal };
  }

  private async cashDrawerAccountIds(shopId: string): Promise<string[]> {
    const rows = await this.ledger.find({ where: { shopId, active: true } });
    return rows
      .filter(
        (a) =>
          a.linkedPaymentMethod === LinkedPaymentMethod.CASH ||
          a.code?.toUpperCase() === 'EFECTIVO',
      )
      .map((a) => a.id);
  }

  private isCashDrawerExpense(
    m: Movement,
    cashIds: string[],
    egresoId: string | null,
  ): boolean {
    if (m.closingId || !isEntityActive(m.active)) return false;
    if (!m.fromAccountId || !cashIds.includes(m.fromAccountId)) return false;
    if (egresoId && m.toAccountId === egresoId) return true;
    return m.concept?.kind === ConceptKind.EXPENSE;
  }

  /** Notifica a admins del local (OWNER/ADMIN) que se retiró efectivo. */
  private async notifyAdminsWithdrawalPicked(
    actor: AuthUser,
    shopId: string,
    info: {
      count: number;
      totalAmount: number;
      pickedByName: string;
      accountName: string;
      closingId?: string | null;
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

    const globalOwners = await this.users.find({
      where: { globalRole: GlobalRole.OWNER },
      select: ['id', 'active'],
    });
    for (const u of globalOwners) {
      if (isEntityActive(u.active)) recipientIds.add(u.id);
    }

    recipientIds.delete(actor.id);
    if (!recipientIds.size) return;

    const total = info.totalAmount.toLocaleString('es-AR');
    const title =
      info.count === 1 ? 'Retiro de efectivo' : `${info.count} retiros de efectivo`;
    const body = `${shopName} · $${total} · ${info.pickedByName} → ${info.accountName}${
      actor.fullName || actor.email ? ` · por ${actor.fullName || actor.email}` : ''
    }`;

    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.CASH_WITHDRAWAL_PICKED,
        title,
        body,
        closingId: info.closingId ?? null,
      })),
    );
  }
}

function actorDisplayName(user: AuthUser): string {
  return String(user.fullName || user.email || '').trim() || 'Usuario';
}
