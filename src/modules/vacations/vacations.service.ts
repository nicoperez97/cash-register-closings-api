import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vacation, VacationPersonType } from '../../entities/vacation.entity';
import { Employee } from '../../entities/employee.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { LedgerAccountType } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { countBusinessDays } from '../../common/shop-open-days';
import { ShopsService } from '../shops/shops.service';

function isIsoDate(v?: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10));
}

export type CreateVacationInput = {
  personType: VacationPersonType;
  employeeId?: string | null;
  partnerAccountId?: string | null;
  fromDate: string;
  toDate: string;
  unpaid?: boolean;
  notes?: string | null;
};

export type UpdateVacationInput = {
  employeeId?: string | null;
  partnerAccountId?: string | null;
  fromDate?: string;
  toDate?: string;
  unpaid?: boolean;
  notes?: string | null;
};

@Injectable()
export class VacationsService implements OnModuleInit {
  constructor(
    @InjectRepository(Vacation) private readonly rows: Repository<Vacation>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.rows.query(`
        CREATE TABLE IF NOT EXISTS vacations (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          personType VARCHAR(16) NOT NULL,
          employeeId CHAR(36) NULL,
          partnerAccountId CHAR(36) NULL,
          fromDate DATE NOT NULL,
          toDate DATE NOT NULL,
          businessDays INT NOT NULL DEFAULT 0,
          unpaid TINYINT(1) NOT NULL DEFAULT 1,
          notes VARCHAR(500) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          KEY idx_vac_shop (shopId),
          KEY idx_vac_person (personType),
          KEY idx_vac_emp (employeeId),
          KEY idx_vac_partner (partnerAccountId),
          KEY idx_vac_from (fromDate),
          KEY idx_vac_to (toDate)
        )
      `);
    } catch {
      // ya existe
    }
  }

  private toDto(row: Vacation) {
    const personName =
      row.personType === VacationPersonType.EMPLOYEE
        ? row.employee?.fullName ?? null
        : row.partnerAccount?.name ?? null;
    return {
      id: row.id,
      shopId: row.shopId,
      personType: row.personType,
      employeeId: row.employeeId ?? null,
      partnerAccountId: row.partnerAccountId ?? null,
      personName,
      fromDate: row.fromDate,
      toDate: row.toDate,
      businessDays: Number(row.businessDays ?? 0),
      unpaid: !!row.unpaid,
      notes: row.notes ?? null,
      active: isEntityActive(row.active),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? null,
    };
  }

  private async loadShop(shopId: string): Promise<Shop> {
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return shop;
  }

  private async assertEmployee(shopId: string, employeeId: string) {
    const emp = await this.employees.findOne({ where: { id: employeeId, shopId } });
    if (!emp || !isEntityActive(emp.active)) {
      throw new BadRequestException('Empleado no encontrado o inactivo');
    }
    return emp;
  }

  private async assertPartnerAccount(shopId: string, accountId: string) {
    const acc = await this.accounts.findOne({ where: { id: accountId, shopId } });
    if (
      !acc ||
      !isEntityActive(acc.active) ||
      acc.type !== LedgerAccountType.PARTNER
    ) {
      throw new BadRequestException('Cuenta de socio no encontrada o inactiva');
    }
    return acc;
  }

  private normalizeDates(fromDate: string, toDate: string) {
    const from = String(fromDate).slice(0, 10);
    const to = String(toDate).slice(0, 10);
    if (!isIsoDate(from) || !isIsoDate(to)) {
      throw new BadRequestException('Fechas inválidas');
    }
    if (to < from) {
      throw new BadRequestException('La fecha hasta debe ser mayor o igual a desde');
    }
    return { from, to };
  }

  async previewDays(user: AuthUser, shopId: string, fromDate?: string, toDate?: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!fromDate || !toDate) {
      throw new BadRequestException('from y to son requeridos');
    }
    const { from, to } = this.normalizeDates(fromDate, toDate);
    const shop = await this.loadShop(shopId);
    return {
      fromDate: from,
      toDate: to,
      businessDays: countBusinessDays(from, to, shop.closedWeekdays),
    };
  }

  async list(
    user: AuthUser,
    shopId: string,
    opts: { personType?: VacationPersonType | ''; from?: string; to?: string } = {},
  ) {
    this.shops.assertShopAccess(user, shopId);
    const qb = this.rows
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.employee', 'employee')
      .leftJoinAndSelect('v.partnerAccount', 'partnerAccount')
      .where('v.shopId = :shopId', { shopId })
      .andWhere('v.active = 1')
      .orderBy('v.fromDate', 'DESC')
      .addOrderBy('v.createdAt', 'DESC');

    if (
      opts.personType === VacationPersonType.EMPLOYEE ||
      opts.personType === VacationPersonType.PARTNER
    ) {
      qb.andWhere('v.personType = :personType', { personType: opts.personType });
    }
    if (opts.from && isIsoDate(opts.from)) {
      qb.andWhere('v.toDate >= :from', { from: opts.from.slice(0, 10) });
    }
    if (opts.to && isIsoDate(opts.to)) {
      qb.andWhere('v.fromDate <= :to', { to: opts.to.slice(0, 10) });
    }

    const rows = await qb.getMany();
    return rows.map((r) => this.toDto(r));
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.rows.findOne({
      where: { id, shopId, active: true },
      relations: ['employee', 'partnerAccount'],
    });
    if (!row) throw new NotFoundException('Vacación no encontrada');
    return this.toDto(row);
  }

  async create(user: AuthUser, shopId: string, dto: CreateVacationInput) {
    this.shops.assertShopAccess(user, shopId);
    const personType = dto.personType;
    if (
      personType !== VacationPersonType.EMPLOYEE &&
      personType !== VacationPersonType.PARTNER
    ) {
      throw new BadRequestException('personType inválido');
    }

    const { from, to } = this.normalizeDates(dto.fromDate, dto.toDate);
    const shop = await this.loadShop(shopId);

    let employeeId: string | null = null;
    let partnerAccountId: string | null = null;

    if (personType === VacationPersonType.EMPLOYEE) {
      if (!dto.employeeId) throw new BadRequestException('employeeId es requerido');
      await this.assertEmployee(shopId, dto.employeeId);
      employeeId = dto.employeeId;
    } else {
      if (!dto.partnerAccountId) {
        throw new BadRequestException('partnerAccountId es requerido');
      }
      await this.assertPartnerAccount(shopId, dto.partnerAccountId);
      partnerAccountId = dto.partnerAccountId;
    }

    const row = this.rows.create({
      shopId,
      personType,
      employeeId,
      partnerAccountId,
      fromDate: from,
      toDate: to,
      businessDays: countBusinessDays(from, to, shop.closedWeekdays),
      unpaid: dto.unpaid !== undefined ? !!dto.unpaid : true,
      notes: dto.notes?.trim() || null,
      active: true,
    });
    const saved = await this.rows.save(row);
    return this.one(user, shopId, saved.id);
  }

  async update(user: AuthUser, shopId: string, id: string, dto: UpdateVacationInput) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.rows.findOne({ where: { id, shopId, active: true } });
    if (!row) throw new NotFoundException('Vacación no encontrada');

    if (row.personType === VacationPersonType.EMPLOYEE && dto.employeeId !== undefined) {
      if (!dto.employeeId) throw new BadRequestException('employeeId es requerido');
      await this.assertEmployee(shopId, dto.employeeId);
      row.employeeId = dto.employeeId;
    }
    if (row.personType === VacationPersonType.PARTNER && dto.partnerAccountId !== undefined) {
      if (!dto.partnerAccountId) {
        throw new BadRequestException('partnerAccountId es requerido');
      }
      await this.assertPartnerAccount(shopId, dto.partnerAccountId);
      row.partnerAccountId = dto.partnerAccountId;
    }

    const from = dto.fromDate !== undefined ? String(dto.fromDate).slice(0, 10) : row.fromDate;
    const to = dto.toDate !== undefined ? String(dto.toDate).slice(0, 10) : row.toDate;
    const dates = this.normalizeDates(from, to);
    row.fromDate = dates.from;
    row.toDate = dates.to;

    if (dto.unpaid !== undefined) row.unpaid = !!dto.unpaid;
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;

    const shop = await this.loadShop(shopId);
    row.businessDays = countBusinessDays(dates.from, dates.to, shop.closedWeekdays);

    await this.rows.save(row);
    return this.one(user, shopId, id);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.rows.findOne({ where: { id, shopId, active: true } });
    if (!row) throw new NotFoundException('Vacación no encontrada');
    row.active = false;
    await this.rows.softRemove(row);
    return { ok: true };
  }
}
