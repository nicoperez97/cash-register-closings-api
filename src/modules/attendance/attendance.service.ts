import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { Employee, EmployeeType } from '../../entities/employee.entity';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import {
  computeOvertimeHours,
  DEFAULT_SERVICE_CHECK_IN,
  DEFAULT_SERVICE_CHECK_OUT,
  parseHhMm,
  requireHhMm,
} from '../../common/shift-hours.util';

const n = (v?: string | number | null) => Number(v ?? 0);

function employeeTypeOf(e: Employee): EmployeeType {
  return e.type === EmployeeType.ROTATING ? EmployeeType.ROTATING : EmployeeType.FIXED;
}

@Injectable()
export class AttendanceService implements OnModuleInit {
  constructor(
    @InjectRepository(AttendanceDay)
    private readonly days: Repository<AttendanceDay>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(ProductionAttendanceDay)
    private readonly prodDays: Repository<ProductionAttendanceDay>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.days.query(`
        ALTER TABLE attendance_days
          ADD COLUMN checkInAt VARCHAR(5) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.days.query(`
        ALTER TABLE attendance_days
          ADD COLUMN checkOutAt VARCHAR(5) NULL
      `);
    } catch {
      // ya existe
    }
  }

  private monthRange(year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to, last };
  }

  private async activeEmployees(shopId: string) {
    // Filtrar en memoria: MySQL tinyint a veces no matchea bien con `active: true` en WHERE.
    const rows = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    return rows.filter((e) => isEntityActive(e.active));
  }

  async getMonth(user: AuthUser, shopId: string, year: number, month: number) {
    this.shops.assertShopAccess(user, shopId);
    if (month < 1 || month > 12) throw new BadRequestException('Mes inválido');
    const { from, to, last } = this.monthRange(year, month);
    const employees = await this.activeEmployees(shopId);
    const rows = await this.days.find({
      where: {
        shopId,
        date: Between(from, to),
        employeeId: In(employees.map((e) => e.id).concat(['__none__'])),
      },
    });
    const byEmp = new Map<string, AttendanceDay[]>();
    for (const r of rows) {
      const list = byEmp.get(r.employeeId) ?? [];
      list.push(r);
      byEmp.set(r.employeeId, list);
    }

    return {
      shopId,
      year,
      month,
      daysInMonth: last,
      employees: employees.map((e) => {
        const empDays = byEmp.get(e.id) ?? [];
        const byDate: Record<
          string,
          {
            id?: string;
            isPresent: boolean;
            isHoliday: boolean;
            checkInAt: string | null;
            checkOutAt: string | null;
            overtimeHours: number;
          }
        > = {};
        for (const d of empDays) {
          byDate[d.date] = {
            id: d.id,
            isPresent: !!d.isPresent,
            isHoliday: !!d.isHoliday,
            checkInAt: d.checkInAt ?? null,
            checkOutAt: d.checkOutAt ?? null,
            overtimeHours: n(d.overtimeHours),
          };
        }
        return {
          employeeId: e.id,
          fullName: e.fullName,
          baseSalary: n(e.baseSalary),
          overtimeHourRate: n(e.overtimeHourRate),
          type: employeeTypeOf(e),
          days: byDate,
        };
      }),
    };
  }

  private shopShiftDefaults(shop: {
    serviceDefaultCheckIn?: string | null;
    serviceDefaultCheckOut?: string | null;
  }) {
    return {
      checkIn: requireHhMm(shop.serviceDefaultCheckIn, DEFAULT_SERVICE_CHECK_IN),
      checkOut: requireHhMm(shop.serviceDefaultCheckOut, DEFAULT_SERVICE_CHECK_OUT),
    };
  }

  private applyShift(
    row: AttendanceDay,
    dto: {
      isPresent?: boolean;
      checkInAt?: string | null;
      checkOutAt?: string | null;
    },
    defaults: { checkIn: string; checkOut: string },
  ) {
    if (dto.isPresent !== undefined) row.isPresent = dto.isPresent;
    if (!row.isPresent) {
      row.checkInAt = null;
      row.checkOutAt = null;
      row.overtimeHours = '0';
      return;
    }
    if (dto.checkInAt !== undefined) {
      row.checkInAt = parseHhMm(dto.checkInAt);
    }
    if (dto.checkOutAt !== undefined) {
      row.checkOutAt = parseHhMm(dto.checkOutAt);
    }
    if (!row.checkInAt) row.checkInAt = defaults.checkIn;
    if (!row.checkOutAt) row.checkOutAt = defaults.checkOut;
    row.overtimeHours = String(
      computeOvertimeHours({
        isPresent: true,
        checkInAt: row.checkInAt,
        checkOutAt: row.checkOutAt,
        defaultCheckOut: defaults.checkOut,
      }),
    );
  }

  async upsertDay(
    user: AuthUser,
    shopId: string,
    dto: {
      employeeId: string;
      date: string;
      isPresent?: boolean;
      isHoliday?: boolean;
      checkInAt?: string | null;
      checkOutAt?: string | null;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const emp = await this.employees.findOne({
      where: { id: dto.employeeId, shopId },
    });
    if (!emp || !isEntityActive(emp.active)) {
      throw new NotFoundException('Empleado no encontrado');
    }
    const shop = await this.shops.getShopEntity(shopId);
    const defaults = this.shopShiftDefaults(shop ?? {});

    let row = await this.days.findOne({
      where: { employeeId: dto.employeeId, date: dto.date },
    });
    if (!row) {
      row = this.days.create({
        shopId,
        employeeId: dto.employeeId,
        date: dto.date,
        isPresent: false,
        isHoliday: false,
        overtimeHours: '0',
        checkInAt: null,
        checkOutAt: null,
        active: true,
      });
    }
    if (dto.isHoliday !== undefined) row.isHoliday = dto.isHoliday;
    this.applyShift(row, dto, defaults);
    await this.days.save(row);
    return {
      id: row.id,
      employeeId: row.employeeId,
      date: row.date,
      isPresent: !!row.isPresent,
      isHoliday: !!row.isHoliday,
      checkInAt: row.checkInAt ?? null,
      checkOutAt: row.checkOutAt ?? null,
      overtimeHours: n(row.overtimeHours),
    };
  }

  async bulkUpsert(
    user: AuthUser,
    shopId: string,
    items: Array<{
      employeeId: string;
      date: string;
      isPresent?: boolean;
      isHoliday?: boolean;
      checkInAt?: string | null;
      checkOutAt?: string | null;
    }>,
  ) {
    const out: Array<{
      id: string;
      employeeId: string;
      date: string;
      isPresent: boolean;
      isHoliday: boolean;
      checkInAt: string | null;
      checkOutAt: string | null;
      overtimeHours: number;
    }> = [];
    for (const item of items) {
      out.push(await this.upsertDay(user, shopId, item));
    }
    return out;
  }

  async overtimeSummary(user: AuthUser, shopId: string, from: string, to: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!from || !to) throw new BadRequestException('Indicá from y to (YYYY-MM-DD)');
    const employees = await this.activeEmployees(shopId);
    const ids = employees.map((e) => e.id);
    const rows = ids.length
      ? await this.days.find({
          where: { shopId, employeeId: In(ids), date: Between(from, to) },
        })
      : [];
    const byEmp = new Map<string, AttendanceDay[]>();
    for (const r of rows) {
      const list = byEmp.get(r.employeeId) ?? [];
      list.push(r);
      byEmp.set(r.employeeId, list);
    }
    const items = employees.map((e) => {
      const days = byEmp.get(e.id) ?? [];
      const overtimeHours = days.reduce((s, d) => s + n(d.overtimeHours), 0);
      const presentDays = days.filter((d) => d.isPresent).length;
      const rate = n(e.overtimeHourRate);
      return {
        employeeId: e.id,
        fullName: e.fullName,
        presentDays,
        overtimeHours,
        overtimeHourRate: rate,
        overtimeCost: Math.round(overtimeHours * rate * 100) / 100,
      };
    });
    const totals = items.reduce(
      (acc, i) => {
        acc.overtimeHours += i.overtimeHours;
        acc.overtimeCost += i.overtimeCost;
        acc.presentDays += i.presentDays;
        return acc;
      },
      { overtimeHours: 0, overtimeCost: 0, presentDays: 0 },
    );
    return {
      shopId,
      from,
      to,
      items,
      totals: {
        overtimeHours: Math.round(totals.overtimeHours * 100) / 100,
        overtimeCost: Math.round(totals.overtimeCost * 100) / 100,
        presentDays: totals.presentDays,
      },
    };
  }

  /** Helpers for payroll. */
  async daysForEmployees(
    shopId: string,
    employeeIds: string[],
    from: string,
    to: string,
  ) {
    if (!employeeIds.length) return [];
    return this.days.find({
      where: {
        shopId,
        employeeId: In(employeeIds),
        date: Between(from, to),
      },
    });
  }

  private async requirePublicAttendanceShop(slug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop || !shop.publicAttendanceEnabled) {
      throw new NotFoundException('Presentismo no disponible en este local');
    }
    return shop;
  }

  async publicEmployeeList(slug: string) {
    const shop = await this.requirePublicAttendanceShop(slug);
    const employees = await this.activeEmployees(shop.id);
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
      employees: employees.map((e) => ({
        id: e.id,
        fullName: e.fullName,
        producesFood: !!e.producesFood,
      })),
    };
  }

  async publicEmployeeMonth(
    slug: string,
    employeeId: string,
    year: number,
    month: number,
  ) {
    const shop = await this.requirePublicAttendanceShop(slug);
    if (month < 1 || month > 12) throw new BadRequestException('Mes inválido');
    const employees = await this.activeEmployees(shop.id);
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) throw new NotFoundException('Empleado no encontrado');
    const { from, to, last } = this.monthRange(year, month);
    const rows = await this.days.find({
      where: { shopId: shop.id, employeeId: emp.id, date: Between(from, to) },
    });
    const prodRows = emp.producesFood
      ? await this.prodDays.find({
          where: { shopId: shop.id, employeeId: emp.id, date: Between(from, to) },
        })
      : [];
    const prodByDate = new Map(prodRows.map((d) => [d.date, n(d.hours)]));
    const days: Record<
      string,
      {
        isPresent: boolean;
        isHoliday: boolean;
        overtimeHours: number;
        hours: number | null;
      }
    > = {};
    for (const d of rows) {
      days[d.date] = {
        isPresent: !!d.isPresent,
        isHoliday: !!d.isHoliday,
        overtimeHours: n(d.overtimeHours),
        hours: emp.producesFood ? (prodByDate.get(d.date) ?? 0) : null,
      };
    }
    if (emp.producesFood) {
      for (const [date, hours] of prodByDate) {
        if (!days[date]) {
          days[date] = {
            isPresent: hours > 0,
            isHoliday: false,
            overtimeHours: 0,
            hours,
          };
        } else {
          days[date].hours = hours;
        }
      }
    }
    let present = 0;
    let holiday = 0;
    let overtimeHours = 0;
    let productionHours = 0;
    for (const d of Object.values(days)) {
      if (d.isPresent) present += 1;
      if (d.isHoliday && !d.isPresent) holiday += 1;
      overtimeHours += d.overtimeHours;
      if (d.hours != null) productionHours += d.hours;
    }
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
      employee: {
        id: emp.id,
        fullName: emp.fullName,
        producesFood: !!emp.producesFood,
      },
      year,
      month,
      daysInMonth: last,
      closedWeekdays: Array.isArray(shop.closedWeekdays) ? shop.closedWeekdays : [],
      days,
      totals: {
        present,
        holiday,
        overtimeHours,
        productionHours: emp.producesFood ? productionHours : null,
      },
    };
  }
}
