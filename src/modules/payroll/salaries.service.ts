import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Employee } from '../../entities/employee.entity';
import {
  EmployeeSalaryHistory,
  SalaryHistorySource,
} from '../../entities/employee-salary-history.entity';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import {
  DEFAULT_SERVICE_CHECK_IN,
  DEFAULT_SERVICE_CHECK_OUT,
  dailyOvertimeHourRate,
  requireHhMm,
} from '../../common/shift-hours.util';
import { ShopsService } from '../shops/shops.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class SalariesService implements OnModuleInit {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeeSalaryHistory)
    private readonly historyRepo: Repository<EmployeeSalaryHistory>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN holidayPayMultiplier DECIMAL(4,2) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.shopsRepo.query(`
        ALTER TABLE shops
          ADD COLUMN holidayPayMultiplier DECIMAL(4,2) NOT NULL DEFAULT 2.00
      `);
    } catch {
      // ya existe
    }
    try {
      await this.shopsRepo.query(`
        ALTER TABLE shops
          ADD COLUMN dailySalaryConvertedAt DATETIME(6) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.historyRepo.query(`
        CREATE TABLE IF NOT EXISTS employee_salary_history (
          id CHAR(36) PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          employeeId CHAR(36) NOT NULL,
          baseSalary DECIMAL(12,2) NOT NULL DEFAULT 0,
          overtimeHourRate DECIMAL(12,2) NOT NULL DEFAULT 0,
          holidayPayMultiplier DECIMAL(4,2) NULL,
          previousBaseSalary DECIMAL(12,2) NULL,
          previousOvertimeHourRate DECIMAL(12,2) NULL,
          previousHolidayPayMultiplier DECIMAL(4,2) NULL,
          note TEXT NULL,
          source ENUM('CREATE', 'UPDATE', 'MIGRATE_DAILY') NOT NULL DEFAULT 'UPDATE',
          createdByUserId CHAR(36) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT NOT NULL DEFAULT 1,
          KEY idx_salary_hist_shop (shopId),
          KEY idx_salary_hist_employee (employeeId),
          KEY idx_salary_hist_created (createdAt)
        )
      `);
    } catch {
      // ya existe / sync
    }
  }

  private shopHolidayMult(shop: Shop): number {
    const v = n(shop.holidayPayMultiplier);
    return v > 0 ? v : 2;
  }

  private effectiveHolidayMult(emp: Employee, shop: Shop): number {
    if (emp.holidayPayMultiplier != null && emp.holidayPayMultiplier !== '') {
      const v = n(emp.holidayPayMultiplier);
      if (v > 0) return v;
    }
    return this.shopHolidayMult(shop);
  }

  private toSalaryRow(e: Employee, shop: Shop) {
    const overtimeHourRate = n(e.overtimeHourRate);
    const daily = n(e.baseSalary);
    const defaultIn = requireHhMm(shop.serviceDefaultCheckIn, DEFAULT_SERVICE_CHECK_IN);
    const defaultOut = requireHhMm(shop.serviceDefaultCheckOut, DEFAULT_SERVICE_CHECK_OUT);
    const effectiveRate = dailyOvertimeHourRate(
      daily,
      overtimeHourRate,
      e.serviceCheckIn || defaultIn,
      e.serviceCheckOut || defaultOut,
    );
    return {
      id: e.id,
      shopId: e.shopId,
      fullName: e.fullName,
      active: isEntityActive(e.active),
      baseSalary: daily,
      overtimeHourRate,
      overtimeHourRateEffective: Math.round(effectiveRate * 100) / 100,
      holidayPayMultiplier:
        e.holidayPayMultiplier == null || e.holidayPayMultiplier === ''
          ? null
          : n(e.holidayPayMultiplier),
      holidayPayMultiplierEffective: this.effectiveHolidayMult(e, shop),
      hireDate: e.hireDate ?? null,
      serviceCheckIn: e.serviceCheckIn ?? null,
      serviceCheckOut: e.serviceCheckOut ?? null,
    };
  }

  async list(user: AuthUser, shopId: string, includeInactive = true) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const rows = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    const filtered = includeInactive
      ? rows
      : rows.filter((r) => isEntityActive(r.active));
    return {
      shopId,
      holidayPayMultiplier: this.shopHolidayMult(shop),
      employees: filtered.map((e) => this.toSalaryRow(e, shop)),
    };
  }

  async recordHistory(opts: {
    shopId: string;
    employeeId: string;
    baseSalary: string;
    overtimeHourRate: string;
    holidayPayMultiplier?: string | null;
    previousBaseSalary?: string | null;
    previousOvertimeHourRate?: string | null;
    previousHolidayPayMultiplier?: string | null;
    note?: string | null;
    source: SalaryHistorySource;
    createdByUserId?: string | null;
  }) {
    await this.historyRepo.save(
      this.historyRepo.create({
        shopId: opts.shopId,
        employeeId: opts.employeeId,
        baseSalary: opts.baseSalary,
        overtimeHourRate: opts.overtimeHourRate,
        holidayPayMultiplier: opts.holidayPayMultiplier ?? null,
        previousBaseSalary: opts.previousBaseSalary ?? null,
        previousOvertimeHourRate: opts.previousOvertimeHourRate ?? null,
        previousHolidayPayMultiplier: opts.previousHolidayPayMultiplier ?? null,
        note: opts.note?.trim() || null,
        source: opts.source,
        createdByUserId: opts.createdByUserId ?? null,
        active: true,
      }),
    );
  }

  async update(
    user: AuthUser,
    shopId: string,
    employeeId: string,
    dto: {
      baseSalary?: number;
      overtimeHourRate?: number;
      holidayPayMultiplier?: number | null;
      note?: string | null;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const row = await this.employees.findOne({ where: { id: employeeId, shopId } });
    if (!row) throw new NotFoundException('Empleado no encontrado');

    if (
      dto.baseSalary === undefined &&
      dto.overtimeHourRate === undefined &&
      dto.holidayPayMultiplier === undefined
    ) {
      throw new BadRequestException('Indicá al menos un campo de sueldo a actualizar');
    }

    const prevBase = row.baseSalary;
    const prevOt = row.overtimeHourRate;
    const prevHol = row.holidayPayMultiplier ?? null;

    if (dto.baseSalary !== undefined) {
      if (dto.baseSalary < 0) throw new BadRequestException('Sueldo inválido');
      row.baseSalary = money(n(dto.baseSalary));
    }
    if (dto.overtimeHourRate !== undefined) {
      if (dto.overtimeHourRate < 0) throw new BadRequestException('Precio de hora extra inválido');
      row.overtimeHourRate = money(n(dto.overtimeHourRate));
    }
    if (dto.holidayPayMultiplier !== undefined) {
      if (dto.holidayPayMultiplier === null) {
        row.holidayPayMultiplier = null;
      } else {
        if (dto.holidayPayMultiplier <= 0) {
          throw new BadRequestException('El multiplicador de feriado debe ser mayor a 0');
        }
        row.holidayPayMultiplier = Number(dto.holidayPayMultiplier).toFixed(2);
      }
    }

    await this.employees.save(row);
    await this.recordHistory({
      shopId,
      employeeId: row.id,
      baseSalary: row.baseSalary,
      overtimeHourRate: row.overtimeHourRate,
      holidayPayMultiplier: row.holidayPayMultiplier ?? null,
      previousBaseSalary: prevBase,
      previousOvertimeHourRate: prevOt,
      previousHolidayPayMultiplier: prevHol,
      note: dto.note,
      source: SalaryHistorySource.UPDATE,
      createdByUserId: user.id,
    });

    return this.toSalaryRow(row, shop);
  }

  async history(
    user: AuthUser,
    shopId: string,
    opts: { employeeId?: string; from?: string; to?: string } = {},
  ) {
    this.shops.assertShopAccess(user, shopId);
    const where: Record<string, unknown> = { shopId };
    if (opts.employeeId) where.employeeId = opts.employeeId;
    if (opts.from && opts.to) {
      where.createdAt = Between(new Date(`${opts.from}T00:00:00`), new Date(`${opts.to}T23:59:59.999`));
    }
    const rows = await this.historyRepo.find({
      where,
      relations: ['employee', 'createdByUser'],
      order: { createdAt: 'DESC' },
    });
    return rows.map((h) => ({
      id: h.id,
      shopId: h.shopId,
      employeeId: h.employeeId,
      employeeName: h.employee?.fullName ?? null,
      employeeActive: h.employee ? isEntityActive(h.employee.active) : null,
      baseSalary: n(h.baseSalary),
      overtimeHourRate: n(h.overtimeHourRate),
      holidayPayMultiplier:
        h.holidayPayMultiplier == null || h.holidayPayMultiplier === ''
          ? null
          : n(h.holidayPayMultiplier),
      previousBaseSalary: h.previousBaseSalary == null ? null : n(h.previousBaseSalary),
      previousOvertimeHourRate:
        h.previousOvertimeHourRate == null ? null : n(h.previousOvertimeHourRate),
      previousHolidayPayMultiplier:
        h.previousHolidayPayMultiplier == null || h.previousHolidayPayMultiplier === ''
          ? null
          : n(h.previousHolidayPayMultiplier),
      note: h.note ?? null,
      source: h.source,
      createdByUserId: h.createdByUserId ?? null,
      createdByName: h.createdByUser?.fullName ?? h.createdByUser?.email ?? null,
      createdAt: h.createdAt,
    }));
  }

  async exportXlsx(user: AuthUser, shopId: string, includeInactive = true) {
    const data = await this.list(user, shopId, includeInactive);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sueldos');
    ws.addRow([
      'Empleado',
      'Estado',
      'Sueldo diario',
      'Precio hora extra',
      'Hora extra efectiva',
      'Mult. feriado (override)',
      'Mult. feriado efectivo',
      'Ingreso',
    ]);
    for (const e of data.employees) {
      ws.addRow([
        e.fullName,
        e.active ? 'Visible' : 'Oculto',
        e.baseSalary,
        e.overtimeHourRate,
        Math.round(e.overtimeHourRateEffective * 100) / 100,
        e.holidayPayMultiplier ?? '',
        e.holidayPayMultiplierEffective,
        e.hireDate ?? '',
      ]);
    }
    ws.getRow(1).font = { bold: true };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = (shop?.slug || shop?.name || 'local')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return { buffer, filename: `sueldos-${slug}.xlsx` };
  }
}
