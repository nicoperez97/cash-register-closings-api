import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from '../../entities/push-subscription.entity';
import { AuthUser } from '../../common/decorators';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  shopId?: string | null;
  shopName?: string | null;
  notificationId?: string | null;
  /** URL absoluta del logo del local (icono de la notificación). */
  icon?: string | null;
  /** Imagen grande (Android/Chrome expanded). */
  image?: string | null;
  /** Total de no leídas del usuario (para badge del ícono PWA). */
  unreadCount?: number;
};

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
  ) {}

  async onModuleInit() {
    try {
      await this.subscriptions.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id CHAR(36) NOT NULL PRIMARY KEY,
          userId CHAR(36) NOT NULL,
          endpoint VARCHAR(512) NOT NULL,
          p256dh VARCHAR(255) NOT NULL,
          auth VARCHAR(255) NOT NULL,
          userAgent VARCHAR(255) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          UNIQUE KEY uq_push_endpoint (endpoint),
          KEY idx_push_user (userId)
        )
      `);
    } catch {
      // ya existe
    }

    const publicKey = this.config.get<string>('webPush.publicKey') ?? '';
    const privateKey = this.config.get<string>('webPush.privateKey') ?? '';
    const subject =
      this.config.get<string>('webPush.subject') ??
      this.config.get<string>('publicAppOrigin') ??
      'https://cierres.perezcompany.com.ar';
    if (!publicKey || !privateKey) {
      this.logger.warn('Web Push deshabilitado: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
      return;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.enabled = true;
    this.logger.log('Web Push habilitado');
  }

  getPublicKey(): string | null {
    const key = this.config.get<string>('webPush.publicKey') ?? '';
    return key || null;
  }

  async upsertSubscription(
    user: AuthUser,
    input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string },
  ) {
    const endpoint = String(input.endpoint || '').trim();
    const p256dh = String(input.keys?.p256dh || '').trim();
    const auth = String(input.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) {
      throw new Error('Suscripción push inválida');
    }

    let row = await this.subscriptions.findOne({
      where: { endpoint },
      withDeleted: true,
    });
    if (!row) {
      row = this.subscriptions.create({
        userId: user.id,
        endpoint,
        p256dh,
        auth,
        userAgent: input.userAgent ?? null,
        active: true,
      });
    } else {
      row.userId = user.id;
      row.p256dh = p256dh;
      row.auth = auth;
      row.userAgent = input.userAgent ?? row.userAgent ?? null;
      row.active = true;
      // Reactivar si estaba soft-deleted
      (row as { deletedAt?: Date | null }).deletedAt = null;
    }
    await this.subscriptions.save(row);
    return { ok: true };
  }

  async removeSubscription(user: AuthUser, endpoint: string) {
    const row = await this.subscriptions.findOne({
      where: { userId: user.id, endpoint: String(endpoint || '').trim() },
    });
    if (!row) return { ok: true };
    await this.subscriptions.softRemove(row);
    return { ok: true };
  }

  /** Envía push a todos los usuarios con suscripción activa (sin mail ni inbox). */
  async sendToAllSubscribers(payload: PushPayload): Promise<{ users: number }> {
    if (!this.enabled) return { users: 0 };
    const raw = await this.subscriptions
      .createQueryBuilder('s')
      .select('DISTINCT s.userId', 'userId')
      .where('s.active = true')
      .getRawMany<{ userId: string }>();
    const userIds = [...new Set(raw.map((r) => String(r.userId || '').trim()).filter(Boolean))];
    if (!userIds.length) return { users: 0 };
    await this.sendToUsers(userIds, payload);
    return { users: userIds.length };
  }

  async broadcastAppUpdate(version?: string): Promise<{ ok: true; users: number }> {
    const tag = version
      ? `crc-app-update-${String(version).trim().slice(0, 16)}`
      : 'crc-app-update';
    const { users } = await this.sendToAllSubscribers({
      title: 'Nueva versión',
      body: 'Hay una actualización disponible. Tocá para abrir la app.',
      url: '/',
      tag,
    });
    this.logger.log(`Broadcast app update (${tag}): ${users} usuario(s) con push`);
    return { ok: true, users };
  }

  async sendToUsers(userIds: string[], payload: PushPayload) {
    if (!this.enabled || !userIds.length) return;
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return;

    const rows = await this.subscriptions.find({
      where: { userId: In(unique), active: true },
    });
    if (!rows.length) return;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      tag: payload.tag || 'crc-notification',
      shopId: payload.shopId ?? null,
      shopName: payload.shopName ?? null,
      notificationId: payload.notificationId ?? null,
      icon: payload.icon || undefined,
      image: payload.image || undefined,
      unreadCount:
        typeof payload.unreadCount === 'number' && payload.unreadCount > 0
          ? Math.floor(payload.unreadCount)
          : undefined,
    });

    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth },
            },
            body,
            { TTL: 60 * 60 * 12, urgency: 'normal' },
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          // 404/410: suscripción vencida
          if (status === 404 || status === 410) {
            try {
              await this.subscriptions.softRemove(row);
            } catch {
              // ignore
            }
            return;
          }
          this.logger.warn(
            `Push falló (${row.userId}): ${(err as Error)?.message ?? err}`,
          );
        }
      }),
    );
  }
}
