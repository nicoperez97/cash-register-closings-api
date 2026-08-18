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
import { CashClosing } from '../../entities/cash-closing.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { AccountsService } from '../accounts/accounts.service';
import { ClosingMovementsSyncService } from '../movements/closing-movements-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/decorators';
import {
  CashPendingWithdrawalStatus,
  GlobalRole,
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
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(Shop) private readonly shopRepo: Repository<Shop>,
    private readonly shops: ShopsService,
    private readonly accounts: AccountsService,
    private readonly closingMovements: ClosingMovementsSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    for (const sql of [
      `ALTER TABLE cash_pending_withdrawals ADD COLUMN pickBatchId VARCHAR(36) NULL`,
      `ALTER TABLE cash_pending_withdrawals ADD COLUMN confirmedByUserId VARCHAR(36) NULL`,
      `ALTER TABLE cash_pending_withdrawals ADD COLUMN confirmedByName VARCHAR(200) NULL`,
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
    return Math.max(0, n(closing.cashAmount) - n(closing.cashLeftInRegister) - expensesTotal);
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
    const rows = await this.pending.find({
      where: {
        shopId,
        status: CashPendingWithdrawalStatus.PENDING,
        active: true,
      },
      order: { businessDate: 'DESC', createdAt: 'DESC' },
    });
    return rows.map((r) => ({
      id: r.id,
      shopId: r.shopId,
      closingId: r.closingId,
      businessDate: r.businessDate,
      amount: n(r.amount),
      status: r.status,
      createdAt: r.createdAt,
    }));
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

    const now = new Date();
    const pickBatchId = randomUUID();
    const confirmedByName = actorDisplayName(user);
    let totalAmount = 0;
    for (const row of rows) {
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
        closing.cashWithdrawn = money(n(row.amount));
      }
      await this.closings.save(closing);
      await this.closingMovements.syncFromClosing(closing);

      row.status = CashPendingWithdrawalStatus.PICKED;
      row.pickedByUserId = picker.id;
      row.pickedByName = picker.fullName;
      row.pickedToAccountId = account.id;
      row.pickedAt = now;
      row.pickBatchId = pickBatchId;
      row.confirmedByUserId = user.id;
      row.confirmedByName = confirmedByName;
      await this.pending.save(row);
      totalAmount += n(row.amount);
    }

    void this.notifyAdminsWithdrawalPicked(user, shopId, {
      count: rows.length,
      totalAmount,
      pickedByName: picker.fullName,
      accountName: account.name,
      closingId: rows.length === 1 ? rows[0].closingId : null,
    }).catch((err) => {
      this.logger.warn(
        `No se pudo notificar retiro: ${(err as Error)?.message ?? err}`,
      );
    });

    return { ok: true, picked: rows.length, pickBatchId };
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
