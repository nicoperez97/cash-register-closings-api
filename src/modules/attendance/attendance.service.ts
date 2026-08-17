import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { Employee, EmployeeType } from '../../entities/employee.entity';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';

const n = (v?: string | number | null) => Number(v ?? 0);

function employeeTypeOf(e: Employee): EmployeeType {
  return e.type === EmployeeType.ROTATING ? EmployeeType.ROTATING : EmployeeType.FIXED;
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceDay)
    private readonly days: Repository<AttendanceDay>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(ProductionAttendanceDay)
    private readonly prodDays: Repository<ProductionAttendanceDay>,
    private readonly shops: ShopsService,
  ) {}

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
            overtimeHours: number;
          }
        > = {};
        for (const d of empDays) {
          byDate[d.date] = {
            id: d.id,
            isPresent: !!d.isPresent,
            isHoliday: !!d.isHoliday,
            overtimeHours: n(d.overtimeHours),
          };
        }
        return {
          employeeId: e.id,
          fullName: e.fullName,
          baseSalary: n(e.baseSalary),
          type: employeeTypeOf(e),
          days: byDate,
        };
      }),
    };
  }

  async upsertDay(
    user: AuthUser,
    shopId: string,
    dto: {
      employeeId: string;
      date: string;
      isPresent?: boolean;
      isHoliday?: boolean;
      overtimeHours?: number;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const emp = await this.employees.findOne({
      where: { id: dto.employeeId, shopId },
    });
    if (!emp || !isEntityActive(emp.active)) {
      throw new NotFoundException('Empleado no encontrado');
    }

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
        active: true,
      });
    }
    if (dto.isPresent !== undefined) row.isPresent = dto.isPresent;
    if (dto.isHoliday !== undefined) row.isHoliday = dto.isHoliday;
    if (dto.overtimeHours !== undefined) {
      row.overtimeHours = String(dto.overtimeHours);
    }
    await this.days.save(row);
    return {
      id: row.id,
      employeeId: row.employeeId,
      date: row.date,
      isPresent: !!row.isPresent,
      isHoliday: !!row.isHoliday,
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
      overtimeHours?: number;
    }>,
  ) {
    const out: Array<{
      id: string;
      employeeId: string;
      date: string;
      isPresent: boolean;
      isHoliday: boolean;
      overtimeHours: number;
    }> = [];
    for (const item of items) {
      out.push(await this.upsertDay(user, shopId, item));
    }
    return out;
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
