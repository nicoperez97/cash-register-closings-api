import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { SalonAreaRule } from '../../entities/salon-area-rule.entity';
import { SalonArea, SalonTable } from '../../entities/salon-table.entity';
import { Reservation, ReservationStatus } from '../../entities/reservation.entity';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { ShopsService } from '../shops/shops.service';

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS salon_tables (
    id CHAR(36) NOT NULL PRIMARY KEY,
    shopId CHAR(36) NOT NULL,
    area VARCHAR(16) NOT NULL DEFAULT 'INSIDE',
    label VARCHAR(40) NOT NULL DEFAULT '',
    seats INT NOT NULL DEFAULT 2,
    sortOrder INT NOT NULL DEFAULT 0,
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updatedAt DATETIME(6) NULL,
    deletedAt DATETIME(6) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_salon_tables_shop (shopId)
  )
`;

const CREATE_RULES_SQL = `
  CREATE TABLE IF NOT EXISTS salon_area_rules (
    id CHAR(36) NOT NULL PRIMARY KEY,
    shopId CHAR(36) NOT NULL,
    area VARCHAR(16) NOT NULL DEFAULT 'INSIDE',
    partySize INT NOT NULL,
    maxCount INT NOT NULL DEFAULT 0,
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updatedAt DATETIME(6) NULL,
    deletedAt DATETIME(6) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_salon_area_rules_shop (shopId)
  )
`;

@Injectable()
export class SalonFloorService implements OnModuleInit {
  constructor(
    @InjectRepository(SalonTable)
    private readonly tables: Repository<SalonTable>,
    @InjectRepository(SalonAreaRule)
    private readonly rules: Repository<SalonAreaRule>,
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    private readonly shops: ShopsService,
    private readonly live: ShopLiveService,
  ) {}

  async onModuleInit() {
    try {
      await this.tables.query(CREATE_TABLES_SQL);
    } catch {
      // ya existe
    }
    try {
      await this.rules.query(CREATE_RULES_SQL);
    } catch {
      // ya existe
    }
  }

  private normalizeArea(raw?: string | null): SalonArea {
    const v = String(raw ?? SalonArea.INSIDE).toUpperCase();
    return v === SalonArea.OUTSIDE ? SalonArea.OUTSIDE : SalonArea.INSIDE;
  }

  private normalizeSeats(raw: number): number {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > 3) {
      throw new BadRequestException('Cada mesa entra de 1 a 3 personas');
    }
    return n;
  }

  private toTableDto(row: SalonTable) {
    return {
      id: row.id,
      shopId: row.shopId,
      area: this.normalizeArea(row.area),
      label: (row.label ?? '').trim(),
      seats: row.seats,
      sortOrder: row.sortOrder,
    };
  }

  private toRuleDto(row: SalonAreaRule) {
    return {
      id: row.id,
      shopId: row.shopId,
      area: this.normalizeArea(row.area),
      partySize: row.partySize,
      maxCount: row.maxCount,
    };
  }

  async getFloor(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const [tableRows, ruleRows] = await Promise.all([
      this.tables.find({ where: { shopId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } }),
      this.rules.find({ where: { shopId }, order: { area: 'ASC', partySize: 'ASC' } }),
    ]);
    return {
      tables: tableRows.filter((r) => isEntityActive(r.active)).map((r) => this.toTableDto(r)),
      rules: ruleRows.filter((r) => isEntityActive(r.active)).map((r) => this.toRuleDto(r)),
    };
  }

  async createTable(
    user: AuthUser,
    shopId: string,
    dto: { area?: string; label?: string; seats?: number },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const area = this.normalizeArea(dto.area);
    const seats = this.normalizeSeats(dto.seats ?? 2);
    const existing = (await this.tables.find({ where: { shopId } })).filter((r) =>
      isEntityActive(r.active),
    );
    const inArea = existing.filter((r) => this.normalizeArea(r.area) === area);
    const nextOrder = inArea.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1;
    const label = (dto.label ?? '').trim() || String(inArea.length + 1);
    const row = this.tables.create({
      shopId,
      area,
      label,
      seats,
      sortOrder: nextOrder,
      active: true,
    });
    await this.tables.save(row);
    this.live.tick(shopId, 'reservations');
    return this.toTableDto(row);
  }

  async updateTable(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: { label?: string; seats?: number },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.tables.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Mesa no encontrada');
    }
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Indicá un nombre o número de mesa');
      row.label = label.slice(0, 40);
    }
    if (dto.seats !== undefined) {
      row.seats = this.normalizeSeats(dto.seats);
    }
    await this.tables.save(row);
    this.live.tick(shopId, 'reservations');
    return this.toTableDto(row);
  }

  async removeTable(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.tables.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Mesa no encontrada');
    row.active = false;
    await this.tables.save(row);
    this.live.tick(shopId, 'reservations');
    return { ok: true };
  }

  async replaceRules(
    user: AuthUser,
    shopId: string,
    dto: { area: string; slots: Array<{ partySize: number; maxCount: number }> },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const area = this.normalizeArea(dto.area);
    const slots = dto.slots ?? [];
    const seen = new Set<number>();
    const clean: Array<{ partySize: number; maxCount: number }> = [];
    for (const slot of slots) {
      const partySize = Math.round(Number(slot.partySize));
      const maxCount = Math.round(Number(slot.maxCount));
      if (!Number.isFinite(partySize) || partySize < 2 || partySize > 20) {
        throw new BadRequestException('El tamaño de mesa armada va de 2 a 20');
      }
      if (!Number.isFinite(maxCount) || maxCount < 0 || maxCount > 99) {
        throw new BadRequestException('La cantidad de mesas armadas va de 0 a 99');
      }
      if (seen.has(partySize)) {
        throw new BadRequestException(`Hay dos reglas para mesas de ${partySize}`);
      }
      seen.add(partySize);
      if (maxCount > 0) clean.push({ partySize, maxCount });
    }

    const existing = (await this.rules.find({ where: { shopId } })).filter(
      (r) => isEntityActive(r.active) && this.normalizeArea(r.area) === area,
    );
    for (const row of existing) {
      row.active = false;
      await this.rules.save(row);
    }
    const created: SalonAreaRule[] = [];
    for (const slot of clean) {
      const row = this.rules.create({
        shopId,
        area,
        partySize: slot.partySize,
        maxCount: slot.maxCount,
        active: true,
      });
      created.push(await this.rules.save(row));
    }
    this.live.tick(shopId, 'reservations');
    return created.map((r) => this.toRuleDto(r));
  }

  async applyFromReservations(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const from = new Date();
    from.setDate(from.getDate() - 60);
    const to = new Date();
    to.setDate(to.getDate() + 30);
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);
    const rows = await this.reservations.find({
      where: {
        shopId,
        status: In([
          ReservationStatus.CONFIRMED,
          ReservationStatus.MARKED,
          ReservationStatus.SEATED,
        ]),
      },
    });
    const inRange = rows.filter((r) => {
      const d = String(r.businessDate ?? '').slice(0, 10);
      return d >= fromIso && d <= toIso;
    });
    if (!inRange.length) {
      throw new BadRequestException(
        'No hay reservas confirmadas recientes para armar el salón',
      );
    }

    for (const area of [SalonArea.INSIDE, SalonArea.OUTSIDE]) {
      const ofArea = inRange.filter((r) => this.normalizeArea(r.area) === area);
      if (!ofArea.length) continue;
      const byDate = new Map<string, number[]>();
      for (const r of ofArea) {
        const d = String(r.businessDate).slice(0, 10);
        const list = byDate.get(d) ?? [];
        list.push(Math.max(2, Math.min(20, Number(r.partySize) || 2)));
        byDate.set(d, list);
      }
      const sizePeak = new Map<number, number>();
      let peakCovers = 0;
      for (const sizes of byDate.values()) {
        const counts = new Map<number, number>();
        let covers = 0;
        for (const s of sizes) {
          counts.set(s, (counts.get(s) ?? 0) + 1);
          covers += s;
        }
        peakCovers = Math.max(peakCovers, covers);
        for (const [size, n] of counts) {
          sizePeak.set(size, Math.max(sizePeak.get(size) ?? 0, n));
        }
      }
      const slots = [...sizePeak.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([partySize, maxCount]) => ({ partySize, maxCount }));
      await this.replaceRules(user, shopId, { area, slots });
      const needed = Math.max(1, Math.ceil(peakCovers / 2));
      const existing = (await this.tables.find({ where: { shopId } })).filter(
        (r) => isEntityActive(r.active) && this.normalizeArea(r.area) === area,
      );
      for (let i = existing.length; i < needed; i++) {
        await this.createTable(user, shopId, { area, seats: 2 });
      }
    }
    return this.getFloor(user, shopId);
  }
}
