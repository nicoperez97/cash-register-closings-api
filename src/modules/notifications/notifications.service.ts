import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppNotification } from '../../entities/notification.entity';
import { NotificationType } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { PushService } from './push.service';
import { MailService } from './mail.service';

function deepLinkFor(type: NotificationType, opts: {
  shopId?: string | null;
  closingId?: string | null;
  paymentId?: string | null;
}): string {
  if (opts.closingId) return `/closings/${opts.closingId}`;
  if (type === NotificationType.CLOSING_CREATED) return '/closings';
  if (type === NotificationType.CASH_WITHDRAWAL_PICKED) return '/cash-withdrawals';
  if (type === NotificationType.PRODUCTION_HOURS_LOGGED) return '/production-attendance';
  if (type === NotificationType.STOCK_BELOW_MINIMUM) return '/stock';
  if (type === NotificationType.STOCK_SHARED) return '/stock';
  if (type === NotificationType.BEVERAGE_STOCK_BELOW_MINIMUM) return '/beverage-stock';
  if (type === NotificationType.BEVERAGE_STOCK_SHARED) return '/beverage-stock';
  if (String(type).startsWith('PAYMENT_')) return '/payments/suppliers';
  return '/';
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @InjectRepository(AppNotification)
    private readonly notifications: Repository<AppNotification>,
    private readonly push: PushService,
    private readonly mail: MailService,
  ) {}

  async onModuleInit() {
    try {
      await this.notifications.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id CHAR(36) NOT NULL PRIMARY KEY,
          userId CHAR(36) NOT NULL,
          shopId CHAR(36) NULL,
          type VARCHAR(40) NOT NULL,
          title VARCHAR(200) NOT NULL,
          body VARCHAR(500) NOT NULL,
          paymentId CHAR(36) NULL,
          closingId CHAR(36) NULL,
          isRead TINYINT(1) NOT NULL DEFAULT 0,
          readAt DATETIME(6) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_notifications_user (userId),
          INDEX idx_notifications_read (isRead)
        )
      `);
    } catch {
      // ya existe
    }
    try {
      await this.notifications.query(`
        ALTER TABLE notifications
          ADD COLUMN closingId CHAR(36) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.notifications.query(`
        ALTER TABLE notifications
          MODIFY COLUMN type ENUM(
            'PAYMENT_VALIDATE',
            'PAYMENT_PAY',
            'PAYMENT_REJECTED',
            'PAYMENT_PAID',
            'CLOSING_CREATED',
            'CASH_WITHDRAWAL_PICKED',
            'PRODUCTION_HOURS_LOGGED',
            'STOCK_BELOW_MINIMUM',
            'STOCK_SHARED',
            'BEVERAGE_STOCK_BELOW_MINIMUM',
            'BEVERAGE_STOCK_SHARED'
          ) NOT NULL
      `);
    } catch {
      // motor sin enum o ya actualizado
    }
    try {
      await this.notifications.query(`
        ALTER TABLE notifications
          MODIFY COLUMN body VARCHAR(2000) NOT NULL
      `);
    } catch {
      // ya actualizado
    }
  }

  async create(input: {
    userId: string;
    shopId?: string | null;
    type: NotificationType;
    title: string;
    body: string;
    paymentId?: string | null;
    closingId?: string | null;
  }) {
    const row = await this.notifications.save(
      this.notifications.create({
        userId: input.userId,
        shopId: input.shopId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        paymentId: input.paymentId ?? null,
        closingId: input.closingId ?? null,
        isRead: false,
        active: true,
      }),
    );
    const dto = this.toDto(row);
    const unreadCount = await this.countUnreadForUser(input.userId);
    void this.push
      .sendToUsers([input.userId], {
        title: input.title,
        body: input.body,
        url: deepLinkFor(input.type, input),
        tag: `crc-${input.type}-${row.id}`,
        shopId: input.shopId ?? null,
        notificationId: row.id,
        unreadCount,
      })
      .catch(() => undefined);
    void this.mail
      .sendNotificationEmail({
        userId: input.userId,
        shopId: input.shopId,
        type: input.type,
        title: input.title,
        body: input.body,
      })
      .catch(() => undefined);
    return dto;
  }

  async createMany(
    inputs: Array<{
      userId: string;
      shopId?: string | null;
      type: NotificationType;
      title: string;
      body: string;
      paymentId?: string | null;
      closingId?: string | null;
    }>,
  ) {
    if (!inputs.length) return [];
    const rows = await this.notifications.save(
      inputs.map((input) =>
        this.notifications.create({
          userId: input.userId,
          shopId: input.shopId ?? null,
          type: input.type,
          title: input.title,
          body: input.body,
          paymentId: input.paymentId ?? null,
          closingId: input.closingId ?? null,
          isRead: false,
          active: true,
        }),
      ),
    );

    // Un push por destinatario (mismo contenido agrupado).
    const byUser = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!byUser.has(row.userId)) byUser.set(row.userId, row);
    }
    void Promise.all(
      [...byUser.entries()].map(async ([userId, row]) => {
        const unreadCount = await this.countUnreadForUser(userId);
        await this.push
          .sendToUsers([userId], {
            title: row.title,
            body: row.body,
            url: deepLinkFor(row.type, {
              shopId: row.shopId,
              closingId: row.closingId,
              paymentId: row.paymentId,
            }),
            tag: `crc-${row.type}-${row.id}`,
            shopId: row.shopId ?? null,
            notificationId: row.id,
            unreadCount,
          })
          .catch(() => undefined);
      }),
    ).catch(() => undefined);

    void this.mail
      .sendNotificationEmails(
        rows.map((row) => ({
          userId: row.userId,
          shopId: row.shopId,
          type: row.type,
          title: row.title,
          body: row.body,
        })),
      )
      .catch(() => undefined);

    return rows.map((r) => this.toDto(r));
  }

  async list(user: AuthUser, opts?: { shopId?: string; unreadOnly?: boolean }) {
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId: user.id })
      .andWhere('n.active = true');
    if (opts?.shopId) {
      qb.andWhere('(n.shopId = :shopId OR n.shopId IS NULL)', { shopId: opts.shopId });
    }
    if (opts?.unreadOnly) {
      qb.andWhere('n.isRead = false');
    }
    qb.orderBy('n.createdAt', 'DESC').take(80);
    const rows = await qb.getMany();
    return rows.map((r) => this.toDto(r));
  }

  async unreadCount(user: AuthUser, shopId?: string) {
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId: user.id })
      .andWhere('n.active = true')
      .andWhere('n.isRead = false');
    if (shopId) {
      qb.andWhere('(n.shopId = :shopId OR n.shopId IS NULL)', { shopId });
    }
    const count = await qb.getCount();
    return { count };
  }

  /** Conteos de no leídas agrupados por local (sin las globales). */
  async unreadCountsByShop(user: AuthUser) {
    const rows = await this.notifications
      .createQueryBuilder('n')
      .select('n.shopId', 'shopId')
      .addSelect('COUNT(*)', 'count')
      .where('n.userId = :userId', { userId: user.id })
      .andWhere('n.active = true')
      .andWhere('n.isRead = false')
      .andWhere('n.shopId IS NOT NULL')
      .groupBy('n.shopId')
      .getRawMany<{ shopId: string; count: string }>();

    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (!row.shopId) continue;
      counts[row.shopId] = Math.max(0, Number(row.count) || 0);
    }
    return { counts };
  }

  async markRead(user: AuthUser, id: string) {
    const row = await this.notifications.findOne({ where: { id, userId: user.id } });
    if (!row) return { ok: false };
    row.isRead = true;
    row.readAt = new Date();
    await this.notifications.save(row);
    return { ok: true };
  }

  async markAllRead(user: AuthUser, shopId?: string) {
    const qb = this.notifications
      .createQueryBuilder()
      .update(AppNotification)
      .set({ isRead: true, readAt: () => 'CURRENT_TIMESTAMP(6)' })
      .where('userId = :userId', { userId: user.id })
      .andWhere('isRead = false')
      .andWhere('active = true');
    if (shopId) {
      qb.andWhere('(shopId = :shopId OR shopId IS NULL)', { shopId });
    }
    await qb.execute();
    return { ok: true };
  }

  private async countUnreadForUser(userId: string): Promise<number> {
    return this.notifications.count({
      where: { userId, active: true, isRead: false },
    });
  }

  private toDto(n: AppNotification) {
    return {
      id: n.id,
      userId: n.userId,
      shopId: n.shopId ?? null,
      type: n.type,
      title: n.title,
      body: n.body,
      paymentId: n.paymentId ?? null,
      closingId: n.closingId ?? null,
      read: !!n.isRead,
      readAt: n.readAt ?? null,
      createdAt: n.createdAt,
    };
  }
}
