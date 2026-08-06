import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole, NotificationType } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const hoursStr = (v: number) => Math.max(0, Number(v) || 0).toFixed(2);

@Injectable()
export class ProductionAttendanceService implements OnModuleInit {
  private readonly logger = new Logger(ProductionAttendanceService.name);

  constructor(
    @InjectRepository(ProductionAttendanceDay)
    private readonly days: Repository<ProductionAttendanceDay>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
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
    const saved = await this.upsertDay(user, shopId, {
      employeeId: emp.id,
      date: dto.date,
      hours: dto.hours,
      isPresent: dto.isPresent,
    });
    void this.notifyAdminsProducerHours(user, shopId, emp, [saved]).catch((err) => {
      this.logger.warn(
        `No se pudo notificar carga de horas: ${(err as Error)?.message ?? err}`,
      );
    });
    return saved;
  }

  async bulkUpsertMy(
    user: AuthUser,
    shopId: string,
    items: Array<{ date: string; hours?: number; isPresent?: boolean }>,
  ) {
    const emp = await this.resolveMyProducer(user, shopId);
    const saved = await this.bulkUpsert(
      user,
      shopId,
      (items ?? []).map((i) => ({
        employeeId: emp.id,
        date: i.date,
        hours: i.hours,
        isPresent: i.isPresent,
      })),
    );
    if (saved.length) {
      void this.notifyAdminsProducerHours(user, shopId, emp, saved).catch((err) => {
        this.logger.warn(
          `No se pudo notificar carga de horas: ${(err as Error)?.message ?? err}`,
        );
      });
    }
    return saved;
  }

  /** Productores a cargo del productor vinculado al usuario. */
  async listMyTeam(user: AuthUser, shopId: string) {
    const me = await this.resolveMyProducer(user, shopId);
    const team = await this.employees.find({
      where: { shopId, supervisorEmployeeId: me.id },
      order: { fullName: 'ASC' },
    });
    return {
      supervisor: { employeeId: me.id, fullName: me.fullName },
      team: team
        .filter((e) => isEntityActive(e.active) && !!e.producesFood)
        .map((e) => ({ employeeId: e.id, fullName: e.fullName })),
    };
  }

  private async assertTeamMember(supervisorId: string, shopId: string, employeeId: string) {
    const emp = await this.employees.findOne({ where: { id: employeeId, shopId } });
    if (
      !emp ||
      !isEntityActive(emp.active) ||
      !emp.producesFood ||
      emp.supervisorEmployeeId !== supervisorId
    ) {
      throw new NotFoundException('Ese productor no está a tu cargo');
    }
    return emp;
  }

  async getTeamMemberRange(
    user: AuthUser,
    shopId: string,
    employeeId: string,
    from: string,
    to: string,
  ) {
    const me = await this.resolveMyProducer(user, shopId);
    const emp = await this.assertTeamMember(me.id, shopId, employeeId);
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

  async upsertTeamMemberDay(
    user: AuthUser,
    shopId: string,
    employeeId: string,
    dto: { date: string; hours?: number; isPresent?: boolean },
  ) {
    const me = await this.resolveMyProducer(user, shopId);
    const emp = await this.assertTeamMember(me.id, shopId, employeeId);
    const saved = await this.upsertDay(user, shopId, {
      employeeId: emp.id,
      date: dto.date,
      hours: dto.hours,
      isPresent: dto.isPresent,
    });
    void this.notifyAdminsProducerHours(user, shopId, emp, [saved]).catch((err) => {
      this.logger.warn(
        `No se pudo notificar carga de horas: ${(err as Error)?.message ?? err}`,
      );
    });
    return saved;
  }

  async bulkUpsertTeamMember(
    user: AuthUser,
    shopId: string,
    employeeId: string,
    items: Array<{ date: string; hours?: number; isPresent?: boolean }>,
  ) {
    const me = await this.resolveMyProducer(user, shopId);
    const emp = await this.assertTeamMember(me.id, shopId, employeeId);
    const saved = await this.bulkUpsert(
      user,
      shopId,
      (items ?? []).map((i) => ({
        employeeId: emp.id,
        date: i.date,
        hours: i.hours,
        isPresent: i.isPresent,
      })),
    );
    if (saved.length) {
      void this.notifyAdminsProducerHours(user, shopId, emp, saved).catch((err) => {
        this.logger.warn(
          `No se pudo notificar carga de horas: ${(err as Error)?.message ?? err}`,
        );
      });
    }
    return saved;
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

  /** Totales de horas: semana actual (lun–dom) + año indicado, por productor. */
  async getSummary(user: AuthUser, shopId: string, year: number) {
    this.shops.assertShopAccess(user, shopId);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Año inválido');
    }

    const now = new Date();
    const day = now.getDay(); // 0=dom
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const iso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const weekFrom = iso(monday);
    const weekTo = iso(sunday);
    const yearFrom = `${year}-01-01`;
    const yearTo = `${year}-12-31`;

    const employees = await this.producerEmployees(shopId);
    const empIds = employees.map((e) => e.id);

    if (!empIds.length) {
      return {
        shopId,
        week: { from: weekFrom, to: weekTo, totalHours: 0, byEmployee: [] },
        year: { year, totalHours: 0, byEmployee: [] },
      };
    }

    const [weekRows, yearRows] = await Promise.all([
      this.days.find({
        where: {
          shopId,
          employeeId: In(empIds),
          date: Between(weekFrom, weekTo),
        },
      }),
      this.days.find({
        where: {
          shopId,
          employeeId: In(empIds),
          date: Between(yearFrom, yearTo),
        },
      }),
    ]);

    const sumByEmp = (rows: ProductionAttendanceDay[]) => {
      const map = new Map<string, number>();
      for (const r of rows) {
        map.set(r.employeeId, (map.get(r.employeeId) ?? 0) + n(r.hours));
      }
      return employees.map((e) => ({
        employeeId: e.id,
        fullName: e.fullName,
        hours: map.get(e.id) ?? 0,
      }));
    };

    const weekByEmployee = sumByEmp(weekRows);
    const yearByEmployee = sumByEmp(yearRows);

    return {
      shopId,
      week: {
        from: weekFrom,
        to: weekTo,
        totalHours: weekByEmployee.reduce((s, e) => s + e.hours, 0),
        byEmployee: weekByEmployee,
      },
      year: {
        year,
        totalHours: yearByEmployee.reduce((s, e) => s + e.hours, 0),
        byEmployee: yearByEmployee,
      },
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

  /** Notifica a admins del local (OWNER/ADMIN) cuando un productor carga sus horas. */
  private async notifyAdminsProducerHours(
    actor: AuthUser,
    shopId: string,
    employee: Employee,
    days: Array<{ date: string; hours: number }>,
  ) {
    if (!days.length) return;

    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const shopName = shop?.name?.trim() || 'Local';
    const links = await this.userShops.find({
      where: {
        shopId,
        shopRole: In([GlobalRole.OWNER, GlobalRole.ADMIN]),
      },
    });
    const recipientIds = new Set(links.map((l) => l.userId));

    const globalOwners = await this.users.find({
      where: { globalRole: GlobalRole.OWNER },
      select: ['id', 'active'],
    });
    for (const u of globalOwners) {
      if (isEntityActive(u.active)) recipientIds.add(u.id);
    }

    recipientIds.delete(actor.id);
    if (!recipientIds.size) return;

    const producerName = employee.fullName?.trim() || actor.fullName || actor.email;
    const totalHours = days.reduce((s, d) => s + n(d.hours), 0);
    const sortedDates = [...days.map((d) => d.date)].sort();
    const title = 'Horas de producción cargadas';
    let body: string;
    if (days.length === 1) {
      const h = n(days[0].hours).toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      body = `${shopName} · ${producerName} cargó ${h} h el ${sortedDates[0]}`;
    } else {
      const total = totalHours.toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      body = `${shopName} · ${producerName} actualizó ${days.length} días (${sortedDates[0]} – ${sortedDates[sortedDates.length - 1]}, total ${total} h)`;
    }

    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.PRODUCTION_HOURS_LOGGED,
        title,
        body,
      })),
    );
  }
}
