import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { NotificationType } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { resolveShopCalendarDate } from '../../common/business-date';
import { isIsoDateOnly, toIsoDateOnly } from '../../common/iso-date';
import { UserShop } from '../../entities/user-shop.entity';
import { Shop } from '../../entities/shop.entity';
import { Reservation, ReservationArea, ReservationStatus } from '../../entities/reservation.entity';
import {
  ReservationRequest,
  ReservationRequestStatus,
} from '../../entities/reservation-request.entity';
import { MailService } from '../notifications/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShopsService } from '../shops/shops.service';
import { ReservationDayNotice } from '../../entities/reservation-day-notice.entity';
import {
  dayOverridesFromRow,
  effectiveReservationFlags,
  shopInsideOpen,
  shopOutsideOpen,
  shopSignupOpen,
} from './reservation-day-settings.util';

export type CreatePublicReservationRequestDto = {
  guestName: string;
  guestEmail: string;
  instagramHandle?: string | null;
  partySize: number;
  businessDate: string;
  reservationTime?: string | null;
  area?: ReservationArea | string | null;
  guestComment?: string | null;
  website?: string | null;
};

@Injectable()
export class ReservationRequestsService implements OnModuleInit {
  constructor(
    @InjectRepository(ReservationRequest)
    private readonly requests: Repository<ReservationRequest>,
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    @InjectRepository(UserShop)
    private readonly userShops: Repository<UserShop>,
    @InjectRepository(Shop)
    private readonly shopsRepo: Repository<Shop>,
    @InjectRepository(ReservationDayNotice)
    private readonly dayNotices: Repository<ReservationDayNotice>,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  async onModuleInit() {
    try {
      await this.requests.query(`
        CREATE TABLE IF NOT EXISTS reservation_requests (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          businessDate DATE NOT NULL,
          guestName VARCHAR(120) NOT NULL,
          guestEmail VARCHAR(180) NOT NULL,
          instagramHandle VARCHAR(30) NULL,
          partySize INT NOT NULL DEFAULT 2,
          reservationTime VARCHAR(5) NULL,
          area VARCHAR(16) NOT NULL DEFAULT 'INSIDE',
          guestComment VARCHAR(400) NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
          reservationId CHAR(36) NULL,
          staffNote VARCHAR(500) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX IDX_reservation_requests_shop_status (shopId, status),
          INDEX IDX_reservation_requests_shop_date (shopId, businessDate)
        )
      `);
    } catch {
      // ya existe
    }
    for (const sql of [
      `ALTER TABLE reservation_requests ADD COLUMN area VARCHAR(16) NOT NULL DEFAULT 'INSIDE'`,
      `ALTER TABLE reservation_requests ADD COLUMN guestComment VARCHAR(400) NULL`,
    ]) {
      try {
        await this.requests.query(sql);
      } catch {
        // ya aplicado
      }
    }
  }

  async publicSignupInfo(slug: string, date?: string) {
    const shop = await this.requirePublicShop(slug);
    const businessDate =
      date != null && String(date).trim() !== '' && isIsoDateOnly(date)
        ? date
        : resolveShopCalendarDate(new Date(), { timezone: shop.timezone });
    const overrides = await this.dayOverridesFor(shop.id, businessDate);
    const flags = effectiveReservationFlags(shop, overrides);
    return {
      signupEnabled: flags.signupEnabled,
      insideEnabled: flags.insideEnabled,
      outsideEnabled: flags.outsideEnabled,
      shopSignupEnabled: shopSignupOpen(shop),
      businessDate,
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
        accentSecondary: shop.accentSecondary ?? null,
        instagramHandle: shop.instagramHandle ?? null,
        phone: shop.phone ?? null,
        timezone: shop.timezone ?? 'America/Argentina/Buenos_Aires',
      },
    };
  }

  async setSignupEnabled(user: AuthUser, shopId: string, enabled: boolean) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertReservationsEnabled(shopId);
    await this.shopsRepo.update(shopId, { reservationSignupEnabled: !!enabled });
    return { reservationSignupEnabled: !!enabled };
  }

  async setAreasEnabled(
    user: AuthUser,
    shopId: string,
    patch: { inside?: boolean; outside?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertReservationsEnabled(shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) {
      throw new NotFoundException('Local no encontrado');
    }
    const inside = patch.inside === undefined ? shopInsideOpen(shop) : !!patch.inside;
    const outside = patch.outside === undefined ? shopOutsideOpen(shop) : !!patch.outside;
    if (!inside && !outside) {
      throw new BadRequestException('Dejá al menos un sector habilitado (adentro o afuera)');
    }
    await this.shopsRepo.update(shopId, {
      reservationInsideEnabled: inside,
      reservationOutsideEnabled: outside,
    });
    return {
      reservationInsideEnabled: inside,
      reservationOutsideEnabled: outside,
    };
  }

  async createPublic(slug: string, dto: CreatePublicReservationRequestDto) {
    if (String(dto.website ?? '').trim()) {
      return { ok: true };
    }
    const shop = await this.requirePublicShop(slug);
    const businessDate = this.normalizeDate(dto.businessDate);
    const today = resolveShopCalendarDate(new Date(), { timezone: shop.timezone });
    if (businessDate < today) {
      throw new BadRequestException('La fecha no puede ser anterior a hoy');
    }
    const overrides = await this.dayOverridesFor(shop.id, businessDate);
    const flags = effectiveReservationFlags(shop, overrides);
    if (!flags.signupEnabled) {
      throw new BadRequestException('No tomamos reservas web para ese día');
    }
    const guestName = String(dto.guestName ?? '').trim();
    if (guestName.length < 2) {
      throw new BadRequestException('Ingresá tu nombre');
    }
    const guestEmail = this.normalizeEmail(dto.guestEmail);
    const instagramHandle = this.normalizeInstagram(dto.instagramHandle);
    const partySize = this.normalizePartySize(dto.partySize);
    const reservationTime = this.normalizeTime(dto.reservationTime);
    const area = this.normalizeArea(dto.area);
    if (area === ReservationArea.OUTSIDE && !flags.outsideEnabled) {
      throw new BadRequestException('El sector afuera no está disponible');
    }
    if (area === ReservationArea.INSIDE && !flags.insideEnabled) {
      throw new BadRequestException('El sector adentro no está disponible');
    }
    const guestComment = this.normalizeComment(dto.guestComment);

    const recent = await this.requests.findOne({
      where: {
        shopId: shop.id,
        guestEmail,
        businessDate,
        status: ReservationRequestStatus.PENDING,
        active: true,
      },
      order: { createdAt: 'DESC' },
    });
    if (recent?.createdAt) {
      const age = Date.now() - new Date(recent.createdAt).getTime();
      if (age < 10 * 60 * 1000) {
        return { ok: true, id: recent.id, status: recent.status };
      }
    }

    const row = await this.requests.save(
      this.requests.create({
        shopId: shop.id,
        businessDate,
        guestName,
        guestEmail,
        instagramHandle,
        partySize,
        reservationTime,
        area,
        guestComment,
        status: ReservationRequestStatus.PENDING,
        active: true,
      }),
    );

    const when = this.formatWhen(businessDate, reservationTime);
    const igBit = instagramHandle ? ` · @${instagramHandle}` : '';
    const areaBit = area === ReservationArea.OUTSIDE ? ' · Afuera' : ' · Adentro';
    await this.notifyStaff(shop.id, shop.name, {
      title: 'Nueva solicitud de reserva',
      body: `${guestName} · ${partySize} ${partySize === 1 ? 'persona' : 'personas'} · ${when}${areaBit}${igBit}`,
    });

    return {
      ok: true,
      id: row.id,
      status: row.status,
    };
  }

  async list(user: AuthUser, shopId: string, status?: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertReservationsEnabled(shopId);
    const qb = this.requests
      .createQueryBuilder('r')
      .where('r.shopId = :shopId', { shopId })
      .andWhere('r.active = true')
      .orderBy('r.createdAt', 'DESC')
      .take(80);
    const st = String(status ?? '').toUpperCase();
    if (st === ReservationRequestStatus.PENDING) {
      qb.andWhere('r.status = :st', { st: ReservationRequestStatus.PENDING });
    } else if (st === ReservationRequestStatus.ACCEPTED) {
      qb.andWhere('r.status = :st', { st: ReservationRequestStatus.ACCEPTED });
    } else if (st === ReservationRequestStatus.REJECTED) {
      qb.andWhere('r.status = :st', { st: ReservationRequestStatus.REJECTED });
    }
    const rows = await qb.getMany();
    return rows.map((r) => this.toDto(r));
  }

  async pendingCount(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertReservationsEnabled(shopId);
    const count = await this.requests.count({
      where: {
        shopId,
        status: ReservationRequestStatus.PENDING,
        active: true,
      },
    });
    return { count };
  }

  async accept(user: AuthUser, shopId: string, id: string, staffNote?: string | null) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.assertReservationsEnabled(shopId);
    const row = await this.findPending(shopId, id);

    const reservation = await this.reservations.save(
      this.reservations.create({
        shopId,
        businessDate: toIsoDateOnly(row.businessDate) || this.normalizeDate(String(row.businessDate)),
        guestName: row.guestName,
        partySize: row.partySize,
        area: row.area === ReservationArea.OUTSIDE ? ReservationArea.OUTSIDE : ReservationArea.INSIDE,
        notes: this.contactNotes(row, staffNote),
        status: ReservationStatus.CONFIRMED,
        reservationTime: row.reservationTime ?? null,
        active: true,
      }),
    );

    row.status = ReservationRequestStatus.ACCEPTED;
    row.reservationId = reservation.id;
    row.staffNote = staffNote?.trim() || null;
    await this.requests.save(row);

    const when = this.formatWhen(
      toIsoDateOnly(row.businessDate) || this.normalizeDate(String(row.businessDate)),
      row.reservationTime,
    );
    const people = `${row.partySize} ${row.partySize === 1 ? 'persona' : 'personas'}`;
    const areaLabel = row.area === ReservationArea.OUTSIDE ? 'Afuera' : 'Adentro';
    void this.mail
      .sendGuestEmail({
        to: row.guestEmail,
        guestName: row.guestName,
        shopId,
        type: 'RESERVATION_ACCEPTED',
        title: `Reserva confirmada en ${shop.name}`,
        body: `Hola ${row.guestName}, tu reserva quedó confirmada.\n\n${people} · ${areaLabel} · ${when}\n\nTe esperamos en ${shop.name}.`,
      })
      .catch(() => undefined);

    return this.toDto(row);
  }

  async reject(user: AuthUser, shopId: string, id: string, staffNote?: string | null) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.assertReservationsEnabled(shopId);
    const row = await this.findPending(shopId, id);
    row.status = ReservationRequestStatus.REJECTED;
    row.staffNote = staffNote?.trim() || null;
    await this.requests.save(row);

    const when = this.formatWhen(
      toIsoDateOnly(row.businessDate) || this.normalizeDate(String(row.businessDate)),
      row.reservationTime,
    );
    const extra = row.staffNote ? `\n\n${row.staffNote}` : '';
    void this.mail
      .sendGuestEmail({
        to: row.guestEmail,
        guestName: row.guestName,
        shopId,
        type: 'RESERVATION_REJECTED',
        title: `No pudimos confirmar tu reserva en ${shop.name}`,
        body: `Hola ${row.guestName}, esta vez no pudimos confirmar tu reserva (${when}).${extra}\n\nSi querés, podés intentar otra fecha o escribirnos. Gracias por pensarnos.`,
      })
      .catch(() => undefined);

    return this.toDto(row);
  }

  private async findPending(shopId: string, id: string) {
    const row = await this.requests.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Solicitud no encontrada');
    }
    if (row.status !== ReservationRequestStatus.PENDING) {
      throw new BadRequestException('Esta solicitud ya fue respondida');
    }
    return row;
  }

  private async dayOverridesFor(shopId: string, businessDate: string) {
    const row = await this.dayNotices.findOne({
      where: { shopId, businessDate, active: true },
    });
    if (!row || !isEntityActive(row.active)) return null;
    return dayOverridesFromRow(row);
  }

  private async requirePublicShop(slug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop || !shop.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles en este local');
    }
    return shop;
  }

  private isSignupOpen(shop: Shop): boolean {
    return shopSignupOpen(shop);
  }

  private isInsideOpen(shop: Shop): boolean {
    return shopInsideOpen(shop);
  }

  private isOutsideOpen(shop: Shop): boolean {
    return shopOutsideOpen(shop);
  }

  private toDto(r: ReservationRequest) {
    const handle = r.instagramHandle?.trim() || null;
    return {
      id: r.id,
      shopId: r.shopId,
      businessDate: toIsoDateOnly(r.businessDate) || this.normalizeDate(String(r.businessDate)),
      guestName: r.guestName,
      guestEmail: r.guestEmail,
      instagramHandle: handle,
      instagramUrl: handle ? `https://www.instagram.com/${handle}/` : null,
      instagramDmUrl: handle ? `https://www.instagram.com/${handle}/` : null,
      partySize: Number(r.partySize ?? 0),
      reservationTime: r.reservationTime ?? null,
      area: r.area === ReservationArea.OUTSIDE ? ReservationArea.OUTSIDE : ReservationArea.INSIDE,
      guestComment: r.guestComment?.trim() || null,
      status: r.status,
      reservationId: r.reservationId ?? null,
      staffNote: r.staffNote ?? null,
      createdAt: r.createdAt,
    };
  }

  private contactNotes(row: ReservationRequest, staffNote?: string | null): string | null {
    const bits = [
      row.guestEmail,
      row.instagramHandle ? `@${row.instagramHandle}` : null,
      row.guestComment?.trim() || null,
      staffNote?.trim() || null,
    ].filter(Boolean);
    return bits.length ? bits.join(' · ') : null;
  }

  private async notifyStaff(
    shopId: string,
    shopName: string,
    msg: { title: string; body: string },
  ) {
    const links = await this.userShops.find({ where: { shopId } });
    const userIds = [
      ...new Set(links.filter((l) => !!l.isReservationAdmin).map((l) => l.userId)),
    ];
    if (!userIds.length) return;
    await this.notifications.createMany(
      userIds.map((userId) => ({
        userId,
        shopId,
        type: NotificationType.RESERVATION_REQUEST,
        title: msg.title,
        body: `${shopName}: ${msg.body}`,
      })),
    );
  }

  private normalizeEmail(raw?: string | null): string {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Ingresá un mail válido');
    }
    return email.slice(0, 180);
  }

  private normalizeInstagram(raw?: string | null): string | null {
    let s = String(raw ?? '').trim();
    if (!s) return null;
    s = s.replace(/^@+/, '');
    s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
    s = s.replace(/[/?#].*$/, '').replace(/^@+/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) {
      throw new BadRequestException('Instagram inválido (solo usuario, sin espacios)');
    }
    return s;
  }

  private normalizePartySize(raw?: number | null): number {
    const n = Math.round(Number(raw ?? 2));
    if (!Number.isFinite(n) || n < 1) {
      throw new BadRequestException('La cantidad de personas debe ser al menos 1');
    }
    return Math.min(n, 99);
  }

  private normalizeDate(raw?: string | null): string {
    const d = String(raw ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw new BadRequestException('Fecha inválida');
    }
    return d;
  }

  private normalizeArea(raw?: string | null): ReservationArea {
    const v = String(raw ?? '').trim().toUpperCase();
    return v === ReservationArea.OUTSIDE ? ReservationArea.OUTSIDE : ReservationArea.INSIDE;
  }

  private normalizeComment(raw?: string | null): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    return s.slice(0, 400);
  }

  private normalizeTime(raw?: string | null): string | null {
    if (raw == null || String(raw).trim() === '') return null;
    const t = String(raw).trim();
    if (!/^\d{1,2}:\d{2}$/.test(t)) {
      throw new BadRequestException('Hora inválida (usá HH:mm)');
    }
    const [h, m] = t.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      throw new BadRequestException('Hora inválida (usá HH:mm)');
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private formatWhen(date: string, time?: string | null): string {
    const [y, m, d] = date.split('-').map(Number);
    const label = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    return time ? `${label} a las ${time}` : label;
  }
}
