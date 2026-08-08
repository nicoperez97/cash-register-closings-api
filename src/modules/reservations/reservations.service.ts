import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Reservation,
  ReservationArea,
  ReservationStatus,
} from '../../entities/reservation.entity';
import { ReservationDayNotice } from '../../entities/reservation-day-notice.entity';
import {
  WaitingListEntry,
  WaitingListStatus,
} from '../../entities/waiting-list-entry.entity';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { ShopsService } from '../shops/shops.service';
import { resolveShopCalendarDate } from '../../common/business-date';
import { isEntityActive } from '../../common/active.util';
import { normalizeLogoUrl } from '../../common/drive-url';
import { isIsoDateOnly, toIsoDateOnly } from '../../common/iso-date';

/** Estados que cuentan para totales / capacidad (excluye canceladas y no-show). */
const ACTIVE_RESERVATION_STATUSES = [
  ReservationStatus.CONFIRMED,
  ReservationStatus.SEATED,
] as const;

export interface UpsertReservationDto {
  businessDate?: string;
  guestName?: string;
  partySize?: number;
  area?: ReservationArea;
  notes?: string | null;
  status?: ReservationStatus;
  reservationTime?: string | null;
}

export interface UpsertWaitingListDto {
  guestName?: string;
  partySize?: number;
  phone?: string;
  area?: ReservationArea;
  notes?: string | null;
  status?: WaitingListStatus;
}

@Injectable()
export class ReservationsService implements OnModuleInit {
  constructor(
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    @InjectRepository(ReservationDayNotice)
    private readonly dayNotices: Repository<ReservationDayNotice>,
    @InjectRepository(WaitingListEntry)
    private readonly waiting: Repository<WaitingListEntry>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.waiting.query(`
        ALTER TABLE waiting_list_entries
          ADD COLUMN area VARCHAR(16) NOT NULL DEFAULT 'INSIDE'
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.dayNotices.query(`
        CREATE TABLE IF NOT EXISTS reservation_day_notices (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          businessDate DATE NOT NULL,
          message TEXT NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          UNIQUE KEY UQ_reservation_day_notices_shop_date (shopId, businessDate),
          INDEX IDX_reservation_day_notices_shop_date (shopId, businessDate)
        )
      `);
    } catch {
      // ya existe
    }
  }

  private toReservationDto(r: Reservation) {
    const businessDate = toIsoDateOnly(r.businessDate);
    if (!businessDate) {
      throw new BadRequestException('Fecha de reserva inválida en base de datos');
    }
    return {
      id: r.id,
      shopId: r.shopId,
      businessDate,
      guestName: r.guestName ?? '',
      partySize: Number(r.partySize ?? 0),
      area: r.area ?? ReservationArea.INSIDE,
      notes: r.notes ?? null,
      status: r.status ?? ReservationStatus.CONFIRMED,
      reservationTime: r.reservationTime ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt ?? null,
    };
  }

  private toWaitingDto(w: WaitingListEntry) {
    return {
      id: w.id,
      shopId: w.shopId,
      guestName: w.guestName,
      partySize: Number(w.partySize ?? 0),
      phone: w.phone,
      area: w.area ?? ReservationArea.INSIDE,
      notes: w.notes ?? null,
      status: w.status ?? WaitingListStatus.WAITING,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt ?? null,
      whatsappUrl: this.whatsappUrl(w.phone),
    };
  }

  private whatsappUrl(phone: string): string {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return `https://wa.me/${digits}`;
  }

  private normalizeArea(raw?: string | null): ReservationArea {
    const v = String(raw ?? ReservationArea.INSIDE).toUpperCase();
    return v === ReservationArea.OUTSIDE ? ReservationArea.OUTSIDE : ReservationArea.INSIDE;
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

  private normalizePhone(raw?: string | null): string {
    const phone = String(raw ?? '').trim();
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) {
      throw new BadRequestException('Teléfono inválido');
    }
    return phone;
  }

  async listReservations(user: AuthUser, shopId: string, date?: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.assertReservationsEnabled(shopId);
    if (date != null && String(date).trim() !== '' && !isIsoDateOnly(date)) {
      throw new BadRequestException('Fecha inválida');
    }
    const businessDate = isIsoDateOnly(date)
      ? date
      : resolveShopCalendarDate(new Date(), {
          timezone: shop.timezone,
        });
    const rows = await this.reservations
      .createQueryBuilder('r')
      .where('r.shopId = :shopId', { shopId })
      .andWhere('r.active = true')
      .andWhere('r.businessDate = :businessDate', { businessDate })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [...ACTIVE_RESERVATION_STATUSES],
      })
      .orderBy('r.createdAt', 'DESC')
      .getMany();
    const notice = await this.findDayNoticeMessage(shopId, businessDate);
    return {
      shopId,
      businessDate,
      notice,
      reservations: rows.map((r, index) => ({
        ...this.toReservationDto(r),
        number: index + 1,
      })),
    };
  }

  async upsertDayNotice(
    user: AuthUser,
    shopId: string,
    dto: { businessDate?: string; message?: string | null },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.assertReservationsEnabled(shopId);
    const dateRaw = dto.businessDate;
    if (dateRaw != null && String(dateRaw).trim() !== '' && !isIsoDateOnly(dateRaw)) {
      throw new BadRequestException('Fecha inválida');
    }
    const businessDate = isIsoDateOnly(dateRaw)
      ? dateRaw
      : resolveShopCalendarDate(new Date(), { timezone: shop.timezone });
    const message = String(dto.message ?? '').trim();

    let row = await this.dayNotices.findOne({
      where: { shopId, businessDate },
      withDeleted: true,
    });

    if (!message) {
      if (row) {
        row.message = '';
        row.active = false;
        row.deletedAt = null as unknown as undefined;
        await this.dayNotices.save(row);
      }
      return { shopId, businessDate, notice: null as string | null };
    }

    if (row) {
      row.message = message;
      row.active = true;
      row.deletedAt = null as unknown as undefined;
      await this.dayNotices.save(row);
    } else {
      row = await this.dayNotices.save(
        this.dayNotices.create({
          shopId,
          businessDate,
          message,
          active: true,
        }),
      );
    }

    return {
      shopId,
      businessDate,
      notice: row.message,
    };
  }

  private async findDayNoticeMessage(
    shopId: string,
    businessDate: string,
  ): Promise<string | null> {
    const row = await this.dayNotices.findOne({
      where: { shopId, businessDate, active: true },
    });
    if (!row || !isEntityActive(row.active)) return null;
    const msg = String(row.message ?? '').trim();
    return msg || null;
  }

  async reservationsSummary(
    user: AuthUser,
    shopId: string,
    from?: string,
    to?: string,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.assertReservationsEnabled(shopId);
    if (from != null && String(from).trim() !== '' && !isIsoDateOnly(from)) {
      throw new BadRequestException('Fecha desde inválida');
    }
    if (to != null && String(to).trim() !== '' && !isIsoDateOnly(to)) {
      throw new BadRequestException('Fecha hasta inválida');
    }
    const today = resolveShopCalendarDate(new Date(), {
      timezone: shop.timezone,
    });
    const monthStart = `${today.slice(0, 7)}-01`;
    const fromDate = isIsoDateOnly(from) ? from : monthStart;
    const toDate = isIsoDateOnly(to) ? to : today;
    if (fromDate > toDate) {
      throw new BadRequestException('Rango de fechas inválido');
    }

    const rows = await this.reservations
      .createQueryBuilder('r')
      .select(`DATE_FORMAT(r.businessDate, '%Y-%m-%d')`, 'day')
      .addSelect('COUNT(*)', 'parties')
      .addSelect('COALESCE(SUM(r.partySize), 0)', 'guests')
      .addSelect(
        `COALESCE(SUM(CASE WHEN r.area = 'OUTSIDE' THEN r.partySize ELSE 0 END), 0)`,
        'outside',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN r.area = 'OUTSIDE' THEN 0 ELSE r.partySize END), 0)`,
        'inside',
      )
      .where('r.shopId = :shopId', { shopId })
      .andWhere('r.active = true')
      .andWhere('r.businessDate BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [...ACTIVE_RESERVATION_STATUSES],
      })
      .groupBy(`DATE_FORMAT(r.businessDate, '%Y-%m-%d')`)
      .orderBy(`DATE_FORMAT(r.businessDate, '%Y-%m-%d')`, 'ASC')
      .getRawMany<{
        day: string;
        parties: string;
        guests: string;
        inside: string;
        outside: string;
      }>();

    const days = rows
      .map((r) => {
        const businessDate = toIsoDateOnly(r.day);
        if (!businessDate) return null;
        return {
          businessDate,
          parties: Number(r.parties) || 0,
          guests: Number(r.guests) || 0,
          inside: Number(r.inside) || 0,
          outside: Number(r.outside) || 0,
        };
      })
      .filter((d): d is NonNullable<typeof d> => !!d);

    return {
      shopId,
      from: fromDate,
      to: toDate,
      days,
    };
  }

  async createReservation(user: AuthUser, shopId: string, dto: UpsertReservationDto) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.assertReservationsEnabled(shopId);
    const businessDate = dto.businessDate
      ? this.normalizeDate(dto.businessDate)
      : resolveShopCalendarDate(new Date(), {
          timezone: shop.timezone,
        });
    const row = await this.reservations.save(
      this.reservations.create({
        shopId,
        businessDate,
        guestName: String(dto.guestName ?? '').trim(),
        partySize: this.normalizePartySize(dto.partySize),
        area: this.normalizeArea(dto.area),
        notes: dto.notes?.trim() || null,
        status: ReservationStatus.CONFIRMED,
        reservationTime: this.normalizeTime(dto.reservationTime),
        active: true,
      }),
    );
    return this.toReservationDto(row);
  }

  async updateReservation(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: UpsertReservationDto,
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertReservationsEnabled(shopId);
    const row = await this.reservations.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (dto.businessDate !== undefined) row.businessDate = this.normalizeDate(dto.businessDate);
    if (dto.guestName !== undefined) row.guestName = String(dto.guestName ?? '').trim();
    if (dto.partySize !== undefined) row.partySize = this.normalizePartySize(dto.partySize);
    if (dto.area !== undefined) row.area = this.normalizeArea(dto.area);
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.status !== undefined) row.status = dto.status;
    if (dto.reservationTime !== undefined) {
      row.reservationTime = this.normalizeTime(dto.reservationTime);
    }
    await this.reservations.save(row);
    return this.toReservationDto(row);
  }

  async removeReservation(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertReservationsEnabled(shopId);
    const row = await this.reservations.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Reserva no encontrada');
    }
    await this.reservations.softRemove(row);
    return { ok: true };
  }

  async listWaiting(user: AuthUser, shopId: string, includeDone = false) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertWaitingListEnabled(shopId);
    const qb = this.waiting
      .createQueryBuilder('w')
      .where('w.shopId = :shopId', { shopId })
      .andWhere('w.active = true');
    if (!includeDone) {
      qb.andWhere('w.status = :status', { status: WaitingListStatus.WAITING });
    }
    qb.orderBy('w.createdAt', 'ASC');
    const rows = await qb.getMany();
    return rows.map((w) => this.toWaitingDto(w));
  }

  async createWaiting(user: AuthUser, shopId: string, dto: UpsertWaitingListDto) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertWaitingListEnabled(shopId);
    const name = String(dto.guestName ?? '').trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    const row = await this.waiting.save(
      this.waiting.create({
        shopId,
        guestName: name,
        partySize: this.normalizePartySize(dto.partySize),
        phone: this.normalizePhone(dto.phone),
        area: this.normalizeArea(dto.area),
        notes: dto.notes?.trim() || null,
        status: WaitingListStatus.WAITING,
        active: true,
      }),
    );
    return this.toWaitingDto(row);
  }

  async updateWaiting(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: UpsertWaitingListDto,
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertWaitingListEnabled(shopId);
    const row = await this.waiting.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Entrada no encontrada');
    }
    if (dto.guestName !== undefined) {
      const name = String(dto.guestName ?? '').trim();
      if (!name) throw new BadRequestException('El nombre es obligatorio');
      row.guestName = name;
    }
    if (dto.partySize !== undefined) row.partySize = this.normalizePartySize(dto.partySize);
    if (dto.phone !== undefined) row.phone = this.normalizePhone(dto.phone);
    if (dto.area !== undefined) row.area = this.normalizeArea(dto.area);
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.status !== undefined) row.status = dto.status;
    await this.waiting.save(row);
    return this.toWaitingDto(row);
  }

  async removeWaiting(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertWaitingListEnabled(shopId);
    const row = await this.waiting.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Entrada no encontrada');
    }
    await this.waiting.softRemove(row);
    return { ok: true };
  }

  /** Público: solo el día calendario actual del local (sin histórico arbitrario). */
  async publicBoard(slug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles en este local');
    }

    const businessDate = resolveShopCalendarDate(new Date(), {
      timezone: shop.timezone,
    });

    const activeRows = await this.reservations
      .createQueryBuilder('r')
      .where('r.shopId = :shopId', { shopId: shop.id })
      .andWhere('r.active = true')
      .andWhere('r.businessDate = :businessDate', { businessDate })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [...ACTIVE_RESERVATION_STATUSES],
      })
      .orderBy('r.createdAt', 'DESC')
      .getMany();

    // SEATED soft-deleted del día: siguen visibles (tachadas) en la pantalla pública.
    const removedSeated = await this.reservations
      .createQueryBuilder('r')
      .withDeleted()
      .where('r.shopId = :shopId', { shopId: shop.id })
      .andWhere('r.businessDate = :businessDate', { businessDate })
      .andWhere('r.status = :status', { status: ReservationStatus.SEATED })
      .andWhere('r.deletedAt IS NOT NULL')
      .orderBy('r.createdAt', 'DESC')
      .getMany();

    const mapRow = (
      r: Reservation,
      number: number,
      removedAfterSeated: boolean,
    ) => ({
      id: r.id,
      guestName: r.guestName || 'Reserva',
      partySize: Number(r.partySize ?? 0),
      area: r.area,
      reservationTime: r.reservationTime ?? null,
      status: r.status,
      number,
      createdAt: r.createdAt,
      removedAfterSeated,
    });

    const activeMapped = activeRows.map((r, i) => mapRow(r, i + 1, false));
    const removedMapped = removedSeated.map((r, i) =>
      mapRow(r, activeMapped.length + i + 1, true),
    );
    const visible = [...activeMapped, ...removedMapped];

    const forTotals = activeMapped;
    const inside = forTotals.filter((r) => r.area === ReservationArea.INSIDE);
    const outside = forTotals.filter((r) => r.area === ReservationArea.OUTSIDE);
    const notice = await this.findDayNoticeMessage(shop.id, businessDate);

    return {
      shop: {
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
      businessDate,
      notice,
      totals: {
        parties: forTotals.length,
        guests: forTotals.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
        inside: inside.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
        outside: outside.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
      },
      reservations: visible,
    };
  }

  /** Público: toggle pendiente ↔ mesa marcada (solo día actual del local). */
  async publicSeatReservation(slug: string, id: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles en este local');
    }
    const businessDate = resolveShopCalendarDate(new Date(), {
      timezone: shop.timezone,
    });
    const row = await this.reservations.findOne({
      where: { id, shopId: shop.id },
    });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Reserva no encontrada');
    }
    const rowDate = toIsoDateOnly(row.businessDate);
    if (rowDate !== businessDate) {
      throw new BadRequestException('Solo se pueden marcar reservas de hoy');
    }
    if (row.status === ReservationStatus.SEATED) {
      row.status = ReservationStatus.CONFIRMED;
      await this.reservations.save(row);
      return {
        id: row.id,
        status: row.status,
        guestName: row.guestName || 'Reserva',
        partySize: Number(row.partySize ?? 0),
        area: row.area,
      };
    }
    if (row.status !== ReservationStatus.CONFIRMED) {
      throw new BadRequestException('La reserva no se puede marcar');
    }
    row.status = ReservationStatus.SEATED;
    await this.reservations.save(row);
    return {
      id: row.id,
      status: row.status,
      guestName: row.guestName || 'Reserva',
      partySize: Number(row.partySize ?? 0),
      area: row.area,
    };
  }

  /** Público: quitar de la vista una liberada (SEATED soft-deleted del día). */
  async publicDismissRemovedReservation(slug: string, id: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles en este local');
    }
    const businessDate = resolveShopCalendarDate(new Date(), {
      timezone: shop.timezone,
    });
    const row = await this.reservations.findOne({
      where: { id, shopId: shop.id },
      withDeleted: true,
    });
    if (!row || !row.deletedAt) {
      throw new NotFoundException('Reserva liberada no encontrada');
    }
    const rowDate = toIsoDateOnly(row.businessDate);
    if (rowDate !== businessDate) {
      throw new BadRequestException('Solo se pueden quitar liberadas de hoy');
    }
    if (row.status !== ReservationStatus.SEATED) {
      throw new BadRequestException('Solo se pueden quitar reservas liberadas post-mesa');
    }
    await this.reservations.delete({ id: row.id, shopId: shop.id });
    return { ok: true };
  }

  /** Público: cola de espera activa por slug. */
  async publicWaitingBoard(slug: string) {
    const shop = await this.shopsRepo.findOne({
      where: { slug: String(slug ?? '').trim().toLowerCase(), active: true },
    });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.waitingListEnabled) {
      throw new NotFoundException('Lista de espera no disponible en este local');
    }

    const rows = await this.waiting.find({
      where: {
        shopId: shop.id,
        status: WaitingListStatus.WAITING,
        active: true,
      },
      order: { createdAt: 'ASC' },
    });

    const inside = rows.filter(
      (r) => (r.area ?? ReservationArea.INSIDE) !== ReservationArea.OUTSIDE,
    );
    const outside = rows.filter((r) => r.area === ReservationArea.OUTSIDE);

    return {
      shop: {
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
      totals: {
        parties: rows.length,
        guests: rows.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
        inside: inside.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
        outside: outside.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
      },
      waiting: rows.map((w, index) => ({
        id: w.id,
        position: index + 1,
        guestName: w.guestName,
        partySize: Number(w.partySize ?? 0),
        area: w.area ?? ReservationArea.INSIDE,
        status: w.status,
      })),
    };
  }

  /**
   * Manifest PWA instalable para tableros públicos.
   * `appOrigin` debe ser el origen del front (mismo host desde el que se sirve el HTML),
   * porque start_url/id/scope tienen que ser same-origin con la página.
   * Los íconos de installability son siempre los PNG same-origin del front.
   * Un logo de Drive/CDN no se usa en el manifest (rompe el criterio 192/512 de Chrome);
   * el logo sigue mostrándose en el tablero y en apple-touch-icon vía el front.
   */
  async buildBoardPwaManifest(
    slug: string,
    kind: 'reservations' | 'waiting',
    appOriginRaw?: string,
  ) {
    const shop = await this.shopsRepo.findOne({
      where: { slug: String(slug ?? '').trim().toLowerCase(), active: true },
    });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (kind === 'reservations' && !shop.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles en este local');
    }
    if (kind === 'waiting' && !shop.waitingListEnabled) {
      throw new NotFoundException('Lista de espera no disponible en este local');
    }

    // ?appOrigin= opcional (contrato legacy del endpoint); el manifest usa paths relativos.
    assertOptionalAppOrigin(appOriginRaw);

    const pathPrefix = kind === 'reservations' ? 'r' : 'w';
    const startPath = `/${pathPrefix}/${encodeURIComponent(shop.slug)}`;
    const fullPrefix = kind === 'reservations' ? 'Reservas' : 'Lista de espera';
    const shortPrefix = kind === 'reservations' ? 'Reservas' : 'Espera';
    const theme =
      (shop.accentColor || '').trim() ||
      (kind === 'waiting' ? '#2e7d32' : '#c45c26');
    const name = `${fullPrefix} · ${shop.name}`;
    // short_name corto: iOS lo usa en el ícono (si no, cae en "Cierres")
    const shortName = shortPrefix;

    return {
      name,
      short_name: shortName,
      description: `${fullPrefix} en vivo — ${shop.name}`,
      lang: 'es-AR',
      dir: 'ltr',
      display: 'standalone',
      orientation: 'any',
      theme_color: theme,
      background_color: '#0e0c0b',
      // id distinto de la app "Cierres" (/) para instalación separada
      id: startPath,
      scope: startPath,
      start_url: startPath,
      categories: ['business', 'food'],
      icons: buildBoardPwaIcons(shop.logoUrl),
    };
  }
}

const DEFAULT_BOARD_PWA_ICONS = [
  {
    src: '/icons/icon-192x192.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: '/icons/icon-512x512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: '/icons/icon-maskable-512x512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
] as const;

function buildBoardPwaIcons(logoUrlRaw?: string | null) {
  const defaults = [...DEFAULT_BOARD_PWA_ICONS];
  const logo = normalizeLogoUrl(logoUrlRaw);
  if (!logo) return defaults;

  const type = guessImageMime(logo);
  // SVG no cumple el criterio de installability de Chromium (hace falta PNG 192 + 512).
  if (type === 'image/svg+xml') return defaults;

  // Logos de Drive / URLs absolutas externas: si son el único ícono (o fallan al
  // descargar / miden <512px), Chrome no muestra "Instalar". Solo usamos logo en el
  // manifest cuando es path same-origin; si no, los PNG del sitio garantizan install.
  if (!isSameOriginIconPath(logo)) return defaults;

  return [
    { src: logo, sizes: '192x192', type, purpose: 'any' },
    { src: logo, sizes: '512x512', type, purpose: 'any' },
    ...defaults,
  ];
}

/** Path relativo same-origin (`/uploads/logo.png`). Absolutas (Drive, CDN) → false. */
function isSameOriginIconPath(src: string): boolean {
  return src.startsWith('/') && !src.startsWith('//');
}

function guessImageMime(url: string): string {
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.png')) return 'image/png';
  if (
    path.includes('googleusercontent.com') ||
    path.includes('drive.google.com') ||
    path.includes('ggpht.com')
  ) {
    return 'image/jpeg';
  }
  return 'image/png';
}

function assertOptionalAppOrigin(raw?: string): void {
  if (raw == null || String(raw).trim() === '') return;
  const candidate = String(raw).trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new BadRequestException('appOrigin inválido');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('appOrigin debe ser http(s)');
  }
}
