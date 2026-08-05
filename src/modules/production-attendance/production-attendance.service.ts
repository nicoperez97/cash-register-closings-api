import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const hoursStr = (v: number) => Math.max(0, Number(v) || 0).toFixed(2);

@Injectable()
export class ProductionAttendanceService implements OnModuleInit {
  constructor(
    @InjectRepository(ProductionAttendanceDay)
    private readonly days: Repository<ProductionAttendanceDay>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.days.query(`
        CREATE TABLE IF NOT EXISTS production_attendance_days (
          id CHAR(36) PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          employeeId CHAR(36) NOT NULL,
          date DATE NOT NULL,
          hours DECIMAL(6,2) NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT NOT NULL DEFAULT 1,
          UNIQUE KEY uq_prod_att_emp_date (employeeId, date),
          KEY idx_prod_att_shop_date (shopId, date),
          KEY idx_prod_att_employee (employeeId)
        )
      `);
    } catch {
      // ignore
    }
  }

  private monthRange(year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to, last };
  }

  private async producerEmployees(shopId: string) {
    const rows = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    return rows.filter((e) => isEntityActive(e.active) && !!e.producesFood);
  }

  private async defaultHoursForShop(shopId: string): Promise<number> {
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const h = n(shop?.productionDefaultHours);
    return h > 0 ? h : 8;
  }

  /** Empleado productor vinculado al usuario logueado. */
  async resolveMyProducer(user: AuthUser, shopId: string): Promise<Employee> {
    this.shops.assertShopAccess(user, shopId);
    const emp = await this.employees.findOne({
      where: { shopId, userId: user.id },
    });
    if (!emp || !isEntityActive(emp.active) || !emp.producesFood) {
      throw new NotFoundException(
        'No hay un productor activo vinculado a tu usuario en este local. Pedile a un admin que te asocie en Empleados (Produce comida + usuario).',
      );
    }
    return emp;
  }

  async getMyRange(user: AuthUser, shopId: string, from: string, to: string) {
    const emp = await this.resolveMyProducer(user, shopId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    if (from > to) throw new BadRequestException('La fecha desde no puede ser posterior a hasta');
    const defaultHours = await this.defaultHoursForShop(shopId);
    const rows = await this.days.find({
      where: {
        shopId,
        employeeId: emp.id,
        date: Between(from, to),
      },
      order: { date: 'ASC' },
    });
    const byDate: Record<string, { id?: string; hours: number; isPresent: boolean }> = {};
    for (const d of rows) {
      const hours = n(d.hours);
      byDate[d.date] = { id: d.id, hours, isPresent: hours > 0 };
    }
    return {
      shopId,
      from,
      to,
      defaultHours,
      employee: { employeeId: emp.id, fullName: emp.fullName },
      days: byDate,
      totalHours: rows.reduce((s, d) => s + n(d.hours), 0),
    };
  }

  async upsertMyDay(
    user: AuthUser,
    shopId: string,
    dto: { date: string; hours?: number; isPresent?: boolean },
  ) {
    const emp = await this.resolveMyProducer(user, shopId);
    return this.upsertDay(user, shopId, {
      employeeId: emp.id,
      date: dto.date,
      hours: dto.hours,
      isPresent: dto.isPresent,
    });
  }

  async bulkUpsertMy(
    user: AuthUser,
    shopId: string,
    items: Array<{ date: string; hours?: number; isPresent?: boolean }>,
  ) {
    const emp = await this.resolveMyProducer(user, shopId);
    return this.bulkUpsert(
      user,
      shopId,
      (items ?? []).map((i) => ({
        employeeId: emp.id,
        date: i.date,
        hours: i.hours,
        isPresent: i.isPresent,
      })),
    );
  }

  async getMonth(user: AuthUser, shopId: string, year: number, month: number) {
    this.shops.assertShopAccess(user, shopId);
    if (month < 1 || month > 12) throw new BadRequestException('Mes inválido');
    const { from, to, last } = this.monthRange(year, month);
    const employees = await this.producerEmployees(shopId);
    const defaultHours = await this.defaultHoursForShop(shopId);
    const rows = await this.days.find({
      where: {
        shopId,
        date: Between(from, to),
        employeeId: In(employees.map((e) => e.id).concat(['__none__'])),
      },
    });
    const byEmp = new Map<string, ProductionAttendanceDay[]>();
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
      defaultHours,
      employees: employees.map((e) => {
        const empDays = byEmp.get(e.id) ?? [];
        const byDate: Record<string, { id?: string; hours: number; isPresent: boolean }> = {};
        for (const d of empDays) {
          const hours = n(d.hours);
          byDate[d.date] = {
            id: d.id,
            hours,
            isPresent: hours > 0,
          };
        }
        return {
          employeeId: e.id,
          fullName: e.fullName,
          days: byDate,
        };
      }),
    };
  }

  async upsertDay(
    user: AuthUser,
    shopId: string,
    dto: { employeeId: string; date: string; hours?: number; isPresent?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const emp = await this.employees.findOne({
      where: { id: dto.employeeId, shopId },
    });
    if (!emp || !isEntityActive(emp.active) || !emp.producesFood) {
      throw new NotFoundException('Productor no encontrado');
    }

    let hours: number | undefined;
    if (dto.hours !== undefined) {
      hours = Math.max(0, n(dto.hours));
    } else if (dto.isPresent === true) {
      hours = await this.defaultHoursForShop(shopId);
    } else if (dto.isPresent === false) {
      hours = 0;
    }

    if (hours === undefined) {
      throw new BadRequestException('Indicá horas o isPresent');
    }

    let row = await this.days.findOne({
      where: { employeeId: dto.employeeId, date: dto.date },
    });
    if (!row) {
      row = this.days.create({
        shopId,
        employeeId: dto.employeeId,
        date: dto.date,
        hours: '0',
        active: true,
      });
    }
    row.hours = hoursStr(hours);
    await this.days.save(row);
    const savedHours = n(row.hours);
    return {
      id: row.id,
      employeeId: row.employeeId,
      date: row.date,
      hours: savedHours,
      isPresent: savedHours > 0,
    };
  }

  async bulkUpsert(
    user: AuthUser,
    shopId: string,
    items: Array<{ employeeId: string; date: string; hours?: number; isPresent?: boolean }>,
  ) {
    const out: Array<{
      id: string;
      employeeId: string;
      date: string;
      hours: number;
      isPresent: boolean;
    }> = [];
    for (const item of items) {
      out.push(await this.upsertDay(user, shopId, item));
    }
    return out;
  }
}
