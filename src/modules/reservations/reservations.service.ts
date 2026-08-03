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
import {
  WaitingListEntry,
  WaitingListStatus,
} from '../../entities/waiting-list-entry.entity';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { ShopsService } from '../shops/shops.service';
import { resolveShopCalendarDate } from '../../common/business-date';
import { isEntityActive } from '../../common/active.util';

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
  }

  private toReservationDto(r: Reservation) {
    return {
      id: r.id,
      shopId: r.shopId,
      businessDate: String(r.businessDate).slice(0, 10),
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
    await this.shops.assertReservationsEnabled(shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const businessDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : resolveShopCalendarDate(new Date(), {
            timezone: shop?.timezone,
          });
    const rows = await this.reservations.find({
      where: { shopId, businessDate, active: true },
      order: { reservationTime: 'ASC', createdAt: 'ASC' },
    });
    return {
      shopId,
      businessDate,
      reservations: rows.map((r) => this.toReservationDto(r)),
    };
  }

  async createReservation(user: AuthUser, shopId: string, dto: UpsertReservationDto) {
    this.shops.assertShopAccess(user, shopId);
    await this.shops.assertReservationsEnabled(shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const businessDate = dto.businessDate
      ? this.normalizeDate(dto.businessDate)
      : resolveShopCalendarDate(new Date(), {
          timezone: shop?.timezone,
        });
    const row = await this.reservations.save(
      this.reservations.create({
        shopId,
        businessDate,
        guestName: String(dto.guestName ?? '').trim(),
        partySize: this.normalizePartySize(dto.partySize),
        area: this.normalizeArea(dto.area),
        notes: dto.notes?.trim() || null,
        status: dto.status ?? ReservationStatus.CONFIRMED,
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
    if (!row) throw new NotFoundException('Reserva no encontrada');
    row.active = false;
    await this.reservations.save(row);
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
    if (!row) throw new NotFoundException('Entrada no encontrada');
    row.active = false;
    await this.waiting.save(row);
    await this.waiting.softRemove(row);
    return { ok: true };
  }

  /** Público: reservas del día calendario actual (o fecha indicada) por slug. */
  async publicBoard(slug: string, date?: string) {
    const shop = await this.shopsRepo.findOne({
      where: { slug: String(slug ?? '').trim().toLowerCase(), active: true },
    });
    if (!shop) throw new NotFoundException('Local no encontrado');
    if (!shop.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles en este local');
    }

    const businessDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : resolveShopCalendarDate(new Date(), {
            timezone: shop.timezone,
          });

    const rows = await this.reservations.find({
      where: {
        shopId: shop.id,
        businessDate,
        active: true,
      },
      order: { reservationTime: 'ASC', createdAt: 'ASC' },
    });

    const visible = rows.filter(
      (r) =>
        r.status === ReservationStatus.CONFIRMED ||
        r.status === ReservationStatus.SEATED,
    );

    const inside = visible.filter((r) => r.area === ReservationArea.INSIDE);
    const outside = visible.filter((r) => r.area === ReservationArea.OUTSIDE);

    return {
      shop: {
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
      businessDate,
      totals: {
        parties: visible.length,
        guests: visible.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
        inside: inside.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
        outside: outside.reduce((s, r) => s + Number(r.partySize ?? 0), 0),
      },
      reservations: visible.map((r) => ({
        id: r.id,
        guestName: r.guestName || 'Reserva',
        partySize: Number(r.partySize ?? 0),
        area: r.area,
        reservationTime: r.reservationTime ?? null,
        status: r.status,
      })),
    };
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
}
