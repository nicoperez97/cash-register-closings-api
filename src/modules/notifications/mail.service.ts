import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import type Transporter from 'nodemailer/lib/mailer';
import { User } from '../../entities/user.entity';
import { Shop } from '../../entities/shop.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { NotificationType } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { resolveShopLogoUrlForEmail } from '../../common/shop-branding.util';
import {
  loadEmailSafeShopLogo,
  probeEmailSafeImageUrl,
  type EmailLogoAsset,
} from '../../common/email-logo.util';
import {
  buildNotificationEmailHtml,
  buildNotificationEmailText,
  type MailTemplateInput,
} from './mail-template';

type MailPayload = {
  userId: string;
  shopId?: string | null;
  type: NotificationType | string;
  title: string;
  body: string;
};

type ShopMailRow = Pick<
  Shop,
  | 'id'
  | 'email'
  | 'name'
  | 'logoUrl'
  | 'accentColor'
  | 'accentSecondary'
  | 'emailSmtpPassword'
  | 'emailNotificationsEnabled'
  | 'emailNotificationTypes'
  | 'emailNotificationUserIds'
>;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private globalTransporter: Transporter | null = null;
  private readonly defaultFrom: string;
  private readonly smtpHost: string;
  private readonly smtpPort: number;
  private readonly smtpSecure: boolean;
  private readonly appOrigin: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
  ) {
    this.defaultFrom = (this.config.get<string>('smtp.from') ?? '').trim();
    this.smtpHost = (this.config.get<string>('smtp.host') ?? '').trim();
    this.smtpPort = this.config.get<number>('smtp.port') ?? 587;
    this.smtpSecure = !!this.config.get<boolean>('smtp.secure');
    this.appOrigin = (
      this.config.get<string>('publicAppOrigin') ??
      process.env.PUBLIC_APP_ORIGIN ??
      ''
    )
      .trim()
      .replace(/\/+$/, '');
    const user = (this.config.get<string>('smtp.user') ?? '').trim();
    const pass = (this.config.get<string>('smtp.pass') ?? '').trim();
    if (this.smtpHost) {
      this.globalTransporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpSecure,
        auth: user ? { user, pass } : undefined,
      });
    } else {
      this.logger.log(
        'SMTP global no configurado: se usará el email/contraseña de cada local (p.ej. Gmail)',
      );
    }
  }

  isEnabled(): boolean {
    return true;
  }

  private shopAllowsEmail(
    shop: ShopMailRow | null | undefined,
    type: string,
    userId: string,
  ): boolean {
    if (!shop) return true;
    const enabled =
      shop.emailNotificationsEnabled === undefined ||
      shop.emailNotificationsEnabled === null
        ? true
        : !!shop.emailNotificationsEnabled;
    if (!enabled) return false;

    const types = Array.isArray(shop.emailNotificationTypes)
      ? shop.emailNotificationTypes
      : null;
    if (types !== null && !types.includes(type)) return false;

    const userIds = Array.isArray(shop.emailNotificationUserIds)
      ? shop.emailNotificationUserIds
      : null;
    if (userIds !== null && !userIds.includes(userId)) return false;

    return true;
  }

  private isReservationMailType(type: string): boolean {
    return (
      type === NotificationType.RESERVATION_REQUEST ||
      type === 'RESERVATION_ACCEPTED' ||
      type === 'RESERVATION_REJECTED'
    );
  }

  private async userIsReservationAdmin(shopId: string, userId: string): Promise<boolean> {
    const link = await this.userShops.findOne({ where: { shopId, userId } });
    return !!link?.isReservationAdmin;
  }

  private async loadShop(shopId: string): Promise<ShopMailRow | null> {
    return this.shops
      .createQueryBuilder('s')
      .addSelect('s.emailSmtpPassword')
      .where('s.id = :id', { id: shopId })
      .getOne();
  }

  private transporterForShop(shop: ShopMailRow | null): {
    transporter: Transporter | null;
    fromEmail: string | null;
  } {
    const shopEmail = shop?.email?.trim() || null;
    const shopPass = shop?.emailSmtpPassword?.trim() || null;
    if (shopEmail && shopPass) {
      const host = this.smtpHost || 'smtp.gmail.com';
      const port = this.smtpHost ? this.smtpPort : 587;
      const secure = this.smtpHost ? this.smtpSecure : false;
      return {
        transporter: nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user: shopEmail, pass: shopPass },
        }),
        fromEmail: shopEmail,
      };
    }
    return {
      transporter: this.globalTransporter,
      fromEmail: shopEmail || this.defaultFrom || null,
    };
  }

  private actionForType(type: string): { path: string; label: string } {
    if (
      type === NotificationType.STOCK_BELOW_MINIMUM ||
      type === NotificationType.STOCK_SHARED
    ) {
      return { path: '/stock', label: 'Abrir stock alimentos' };
    }
    if (
      type === NotificationType.BEVERAGE_STOCK_BELOW_MINIMUM ||
      type === NotificationType.BEVERAGE_STOCK_SHARED
    ) {
      return { path: '/beverage-stock', label: 'Abrir stock bebidas' };
    }
    if (type === NotificationType.CLOSING_CREATED) {
      return { path: '/closings', label: 'Ver cierres' };
    }
    if (type === NotificationType.CASH_WITHDRAWAL_PICKED) {
      return { path: '/cash-withdrawals', label: 'Ver retiros' };
    }
    if (type === NotificationType.PRODUCTION_HOURS_LOGGED) {
      return { path: '/production-attendance', label: 'Ver producción' };
    }
    if (
      type === NotificationType.SHORTAGE_CREATED ||
      type === NotificationType.SHORTAGE_LEVEL_LOW ||
      type === NotificationType.SHORTAGE_RESOLVED
    ) {
      return { path: '/shortages', label: 'Abrir faltantes' };
    }
    if (String(type).startsWith('PAYMENT_')) {
      return { path: '/payments/suppliers', label: 'Ver pagos' };
    }
    if (type === NotificationType.RESERVATION_REQUEST) {
      return { path: '/reservations', label: 'Ver solicitudes' };
    }
    return { path: '/', label: 'Abrir la app' };
  }

  private async renderMail(input: MailPayload, shop: ShopMailRow | null, user: User) {
    const action = this.actionForType(String(input.type));
    const actionUrl = this.appOrigin ? `${this.appOrigin}${action.path}` : null;
    const { shopLogoUrl, logo } = await this.resolveMailLogo(
      input.shopId,
      shop?.logoUrl,
    );
    const tpl: MailTemplateInput = {
      type: String(input.type),
      title: input.title,
      body: input.body,
      recipientName: user.fullName,
      shopName: shop?.name ?? null,
      shopLogoUrl,
      accentColor: shop?.accentColor ?? null,
      accentSecondary: shop?.accentSecondary ?? null,
      actionUrl,
      actionLabel: action.label,
    };
    return {
      text: buildNotificationEmailText(tpl),
      html: buildNotificationEmailHtml(tpl),
      logo,
    };
  }

  /**
   * 1) URL https pública si realmente sirve JPEG/PNG/GIF (sin adjunto en Gmail).
   * 2) Si no (API local → prod 404, WebP, etc.): CID embebido para que el logo se vea.
   */
  private async resolveMailLogo(
    shopId: string | null | undefined,
    logoUrlRaw?: string | null,
  ): Promise<{ shopLogoUrl: string | null; logo: EmailLogoAsset | null }> {
    const hosted = this.emailLogoUrl(shopId, logoUrlRaw);
    if (hosted && (await probeEmailSafeImageUrl(hosted))) {
      return { shopLogoUrl: hosted, logo: null };
    }
    const logo = await loadEmailSafeShopLogo(logoUrlRaw);
    if (logo) {
      return { shopLogoUrl: `cid:${logo.cid}`, logo };
    }
    return { shopLogoUrl: null, logo: null };
  }

  private logoAttachments(logo: EmailLogoAsset | null) {
    if (!logo) return undefined;
    return [
      {
        filename: false as const,
        content: logo.buffer,
        contentType: logo.contentType,
        cid: logo.cid,
      },
    ];
  }

  private emailLogoUrl(
    shopId: string | null | undefined,
    logoUrlRaw?: string | null,
  ): string | null {
    // Solo como fallback: PNG/JPEG públicos. WebP/SVG se omiten (rompen en Gmail/Outlook).
    const raw = (logoUrlRaw ?? '').trim().toLowerCase();
    if (raw.endsWith('.webp') || raw.endsWith('.svg') || raw.includes('image/webp')) {
      return null;
    }
    return resolveShopLogoUrlForEmail(this.appOrigin, shopId, logoUrlRaw);
  }

  async sendNotificationEmail(input: MailPayload): Promise<void> {
    let shop: ShopMailRow | null = null;
    if (input.shopId) {
      shop = await this.loadShop(input.shopId);
      const type = String(input.type);
      let allowed = this.shopAllowsEmail(shop, type, input.userId);
      if (!allowed && shop && this.isReservationMailType(type)) {
        const enabled =
          shop.emailNotificationsEnabled === undefined ||
          shop.emailNotificationsEnabled === null
            ? true
            : !!shop.emailNotificationsEnabled;
        const types = Array.isArray(shop.emailNotificationTypes)
          ? shop.emailNotificationTypes
          : null;
        const typeOk = types === null || types.includes(type);
        if (enabled && typeOk) {
          allowed = await this.userIsReservationAdmin(shop.id, input.userId);
        }
      }
      if (!allowed) return;
    }

    const { transporter, fromEmail } = this.transporterForShop(shop);
    if (!transporter) {
      this.logger.warn(
        'Sin SMTP (ni del local ni global): email omitido. Configurá email + contraseña en el local.',
      );
      return;
    }

    const user = await this.users.findOne({
      where: { id: input.userId },
      select: ['id', 'email', 'fullName', 'active'],
    });
    if (!user || !isEntityActive(user.active) || !user.email?.trim()) return;
    if (user.email.includes('@import.cierres.local')) return;

    const from = fromEmail;
    if (!from) {
      this.logger.warn('Sin remitente (shop.email ni SMTP_FROM): email omitido');
      return;
    }

    const shopName = shop?.name?.trim() || null;
    const fromHeader = shopName ? `"${shopName}" <${from}>` : from;
    const rendered = await this.renderMail(input, shop, user);

    try {
      await transporter.sendMail({
        from: fromHeader,
        to: user.email.trim(),
        subject: input.title,
        text: rendered.text,
        html: rendered.html,
        attachments: this.logoAttachments(rendered.logo),
        replyTo: shop?.email?.trim() || undefined,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo enviar email a ${user.email}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /** Mail a un comensal (no es usuario del sistema). No respeta filtros de staff. */
  async sendGuestEmail(input: {
    to: string;
    guestName: string;
    shopId: string;
    type: string;
    title: string;
    body: string;
  }): Promise<void> {
    const to = String(input.to ?? '').trim();
    if (!to) return;
    const shop = await this.loadShop(input.shopId);
    const { transporter, fromEmail } = this.transporterForShop(shop);
    if (!transporter || !fromEmail) {
      this.logger.warn(
        'Sin SMTP: no se envió el mail al comensal. Configurá email + contraseña en el local.',
      );
      return;
    }
    const shopName = shop?.name?.trim() || null;
    const fromHeader = shopName ? `"${shopName}" <${fromEmail}>` : fromEmail;
    const { shopLogoUrl, logo } = await this.resolveMailLogo(
      input.shopId,
      shop?.logoUrl,
    );
    const tpl: MailTemplateInput = {
      type: input.type,
      title: input.title,
      body: input.body,
      recipientName: input.guestName,
      shopName,
      shopLogoUrl,
      accentColor: shop?.accentColor ?? null,
      accentSecondary: shop?.accentSecondary ?? null,
      actionUrl: null,
      actionLabel: null,
    };
    try {
      await transporter.sendMail({
        from: fromHeader,
        to,
        subject: input.title,
        text: buildNotificationEmailText(tpl),
        html: buildNotificationEmailHtml(tpl),
        attachments: this.logoAttachments(logo),
        replyTo: shop?.email?.trim() || undefined,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo enviar email al comensal ${to}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  async sendNotificationEmails(inputs: MailPayload[]): Promise<void> {
    if (!inputs.length) return;

    const userIds = [...new Set(inputs.map((i) => i.userId))];
    const shopIds = [
      ...new Set(inputs.map((i) => i.shopId).filter((id): id is string => !!id)),
    ];

    const [users, shops] = await Promise.all([
      this.users.find({
        where: { id: In(userIds) },
        select: ['id', 'email', 'fullName', 'active'],
      }),
      shopIds.length
        ? this.shops
            .createQueryBuilder('s')
            .addSelect('s.emailSmtpPassword')
            .where('s.id IN (:...ids)', { ids: shopIds })
            .getMany()
        : Promise.resolve([] as Shop[]),
    ]);

    const userById = new Map(users.map((u) => [u.id, u]));
    const shopById = new Map(shops.map((s) => [s.id, s as ShopMailRow]));

    const byUser = new Map<string, MailPayload>();
    for (const input of inputs) {
      if (!byUser.has(input.userId)) byUser.set(input.userId, input);
    }

    for (const input of byUser.values()) {
      const shop = input.shopId ? shopById.get(input.shopId) ?? null : null;
      if (input.shopId && !this.shopAllowsEmail(shop, String(input.type), input.userId)) {
        continue;
      }

      const user = userById.get(input.userId);
      if (!user || !isEntityActive(user.active) || !user.email?.trim()) continue;
      if (user.email.includes('@import.cierres.local')) continue;

      const { transporter, fromEmail } = this.transporterForShop(shop);
      if (!transporter || !fromEmail) continue;

      const shopName = shop?.name?.trim() || null;
      const fromHeader = shopName ? `"${shopName}" <${fromEmail}>` : fromEmail;
      const rendered = await this.renderMail(input, shop, user);
      try {
        await transporter.sendMail({
          from: fromHeader,
          to: user.email.trim(),
          subject: input.title,
          text: rendered.text,
          html: rendered.html,
          attachments: this.logoAttachments(rendered.logo),
          replyTo: shop?.email?.trim() || undefined,
        });
      } catch (err) {
        this.logger.warn(
          `No se pudo enviar email a ${user.email}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }
}
