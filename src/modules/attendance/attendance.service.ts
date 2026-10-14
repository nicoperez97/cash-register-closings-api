import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Between, In, Repository } from 'typeorm';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { Employee } from '../../entities/employee.entity';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { Shop } from '../../entities/shop.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { resolveShopBusinessDate } from '../../common/business-date';
import { NotificationType } from '../../common/enums';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  computeOvertimeHours,
  parseHhMm,
  resolveOvertimeHourRate,
} from '../../common/shift-hours.util';
import {
  findShopShift,
  normalizeShopShifts,
  resolveCurrentShift,
  shiftsOnWeekday,
} from '../../common/shop-shifts';
import {
  employeeTypeForShift,
  employeeWorksFixedShift,
  employeeWorksShift,
  normalizeShiftAssignments,
  shiftServiceSchedule,
  shiftWindowFallback,
  weekdayOf,
} from '../../common/employee-shift.util';

function hashEmployeePin(pin: string): string {
  return createHash('sha256').update(String(pin).trim()).digest('hex');
}

/** tinyint puede venir como 0/1; default true si null/undefined. */
function employeeShowsInFichar(emp: { showInFichar?: boolean | number | null }): boolean {
  if (emp.showInFichar === undefined || emp.showInFichar === null) return true;
  return !!emp.showInFichar;
}

const n = (v?: string | number | null) => Number(v ?? 0);

@Injectable()
export class AttendanceService implements OnModuleInit {
  constructor(
    @InjectRepository(AttendanceDay)
    private readonly days: Repository<AttendanceDay>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(ProductionAttendanceDay)
    private readonly prodDays: Repository<ProductionAttendanceDay>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly live: ShopLiveService,
    private readonly notifications: NotificationsService,
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
    try {
      await this.days.query(`
        ALTER TABLE attendance_days
          ADD COLUMN shiftId VARCHAR(36) NULL
      `);
    } catch {
      // ya existe
    }
    await this.backfillAttendanceShifts().catch((err) => {
      // No tumbar el API: dumps viejos pueden traer presentismo duplicado sin turno.
      console.warn(
        `[AttendanceService] No se pudo backfill de turnos: ${(err as Error)?.message ?? err}`,
      );
    });
    try {
      await this.days.query(`
        CREATE INDEX IDX_attendance_days_employeeId ON attendance_days (employeeId)
      `);
    } catch {
      // ya existe
    }
    for (const idx of [
      'uq_attendance_emp_date',
      'IDX_attendance_days_employeeId_date',
      'IDX_1008e668552b6b78be7ea20d11',
    ]) {
      try {
        await this.days.query(`ALTER TABLE attendance_days DROP INDEX \`${idx}\``);
      } catch {
        // no estaba o lo usa una FK
      }
    }
    try {
      await this.days.query(`
        ALTER TABLE attendance_days
          ADD UNIQUE INDEX uq_attendance_emp_date_shift (employeeId, date, shiftId)
      `);
    } catch {
      // ya existe
    }
  }

  private async backfillAttendanceShifts() {
    const ids: Array<{ shopId: string }> = await this.days.query(
      `SELECT DISTINCT shopId AS shopId FROM attendance_days WHERE shiftId IS NULL OR shiftId = ''`,
    );
    for (const row of ids) {
      const shop = await this.shops.getShopEntity(row.shopId);
      if (!shop) continue;
      const shifts = normalizeShopShifts(shop.shifts, shop.openingTime);
      const shift = shifts[0];
      if (!shift) continue;

      // Si ya hay fila con ese turno el mismo día, descarto las vacías (dumps / migraciones).
      await this.days.query(
        `
        UPDATE attendance_days a
        INNER JOIN attendance_days b
          ON b.employeeId = a.employeeId
          AND b.date = a.date
          AND b.shiftId = ?
          AND b.id <> a.id
          AND b.deletedAt IS NULL
        SET a.active = 0, a.deletedAt = NOW(6)
        WHERE a.shopId = ?
          AND (a.shiftId IS NULL OR a.shiftId = '')
          AND a.deletedAt IS NULL
        `,
        [shift.id, shop.id],
      );

      // Varias vacías mismo empleado+día: dejo la más vieja.
      await this.days.query(
        `
        UPDATE attendance_days a
        INNER JOIN attendance_days b
          ON b.employeeId = a.employeeId
          AND b.date = a.date
          AND (b.shiftId IS NULL OR b.shiftId = '')
          AND b.createdAt < a.createdAt
          AND b.deletedAt IS NULL
        SET a.active = 0, a.deletedAt = NOW(6)
        WHERE a.shopId = ?
          AND (a.shiftId IS NULL OR a.shiftId = '')
          AND a.deletedAt IS NULL
        `,
        [shop.id],
      );

      await this.days.query(
        `
        UPDATE attendance_days
        SET shiftId = ?
        WHERE shopId = ? AND (shiftId IS NULL OR shiftId = '') AND deletedAt IS NULL
        `,
        [shift.id, shop.id],
      );
    }
  }

  private async resolveAttendanceShift(shopId: string, shiftId?: string | null) {
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop) throw new NotFoundException('Local no encontrado');
    const shifts = normalizeShopShifts(shop.shifts, shop.openingTime);
    const shift = shiftId
      ? findShopShift(shifts, shiftId)
      : resolveCurrentShift(shifts, new Date(), shop.timezone);
    if (!shift || (shiftId && shift.id !== shiftId)) {
      throw new BadRequestException('Turno inválido para este local');
    }
    return { shop, shift };
  }

  private monthRange(year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to, last };
  }

  private async listEmployees(
    shopId: string,
    filter: 'active' | 'inactive' | 'all' = 'active',
  ) {
    // Filtrar en memoria: MySQL tinyint a veces no matchea bien con `active: true` en WHERE.
    const rows = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    if (filter === 'all') return rows;
    if (filter === 'inactive') return rows.filter((e) => !isEntityActive(e.active));
    return rows.filter((e) => isEntityActive(e.active));
  }

  private parseEmployeesFilter(raw?: string | null): 'active' | 'inactive' | 'all' {
    const v = String(raw ?? '')
      .toLowerCase()
      .trim();
    if (v === 'inactive' || v === 'deactivated' || v === 'disabled') return 'inactive';
    if (v === 'all') return 'all';
    return 'active';
  }

  async getMonth(
    user: AuthUser,
    shopId: string,
    year: number,
    month: number,
    shiftId?: string | null,
    employeesFilterRaw?: string | null,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (month < 1 || month > 12) throw new BadRequestException('Mes inválido');
    const { shift } = await this.resolveAttendanceShift(shopId, shiftId);
    const { from, to, last } = this.monthRange(year, month);
    const employeesFilter = this.parseEmployeesFilter(employeesFilterRaw);
    const employees = await this.listEmployees(shopId, employeesFilter);
    const rows = await this.days.find({
      where: {
        shopId,
        shiftId: shift.id,
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
      employeesFilter,
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
          active: isEntityActive(e.active),
          baseSalary: n(e.baseSalary),
          overtimeHourRate: n(e.overtimeHourRate),
          serviceCheckIn: e.serviceCheckIn ?? null,
          serviceCheckOut: e.serviceCheckOut ?? null,
          type: employeeTypeForShift(e, shift.id),
          shiftAssignments: normalizeShiftAssignments(e.shiftAssignments),
          countsForAttendanceBonus:
            e.countsForAttendanceBonus === undefined || e.countsForAttendanceBonus === null
              ? true
              : !!e.countsForAttendanceBonus,
          worksThisShift: employeeWorksShift(e, shift.id),
          days: byDate,
        };
      }),
    };
  }

  private withHours(shop?: { serviceAttendanceWithHours?: boolean | number | null } | null) {
    const v = shop?.serviceAttendanceWithHours;
    if (v === false || v === 0) return false;
    return true;
  }

  private scheduleFallback(
    shop?: {
      shifts?: Parameters<typeof normalizeShopShifts>[0];
      openingTime?: string | null;
    } | null,
    shiftId?: string | null,
  ) {
    const shifts = normalizeShopShifts(shop?.shifts, shop?.openingTime);
    return shiftWindowFallback(shifts, shiftId);
  }

  private employeeShiftDefaults(
    shop: {
      shifts?: Parameters<typeof normalizeShopShifts>[0];
      openingTime?: string | null;
    } | null | undefined,
    emp?: {
      serviceCheckIn?: string | null;
      serviceCheckOut?: string | null;
      shiftAssignments?: Parameters<typeof shiftServiceSchedule>[0]['shiftAssignments'];
    } | null,
    shiftId?: string | null,
    date?: string | null,
  ) {
    return shiftServiceSchedule(
      emp ?? {},
      shiftId,
      this.scheduleFallback(shop, shiftId),
      weekdayOf(date),
    );
  }

  /** Baseline de extras: día del turno → asignación → empleado → ventana del turno. */
  private overtimeBaseline(
    shop: {
      shifts?: Parameters<typeof normalizeShopShifts>[0];
      openingTime?: string | null;
    } | null | undefined,
    emp: {
      serviceCheckIn?: string | null;
      serviceCheckOut?: string | null;
      shiftAssignments?: Parameters<typeof shiftServiceSchedule>[0]['shiftAssignments'];
    } | null | undefined,
    shiftId?: string | null,
    date?: string | null,
  ) {
    return this.employeeShiftDefaults(shop, emp, shiftId, date);
  }

  /**
   * @param fillMissingDefaults Si true (default), al marcar presente sin punch
   * parcial rellena entrada/salida con defaults del turno. Si el DTO trae solo
   * una hora, no completa la otra (fichaje en dos pasos).
   */
  private applyShift(
    row: AttendanceDay,
    dto: {
      isPresent?: boolean;
      checkInAt?: string | null;
      checkOutAt?: string | null;
    },
    defaults: { checkIn: string; checkOut: string },
    withHours: boolean,
    opts?: { fillMissingDefaults?: boolean },
  ) {
    if (dto.isPresent !== undefined) row.isPresent = dto.isPresent;
    if (!withHours) {
      row.checkInAt = null;
      row.checkOutAt = null;
      row.overtimeHours = '0';
      return;
    }
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
    const hasInField = dto.checkInAt !== undefined;
    const hasOutField = dto.checkOutAt !== undefined;
    const innVal = hasInField ? parseHhMm(dto.checkInAt) : row.checkInAt;
    const outVal = hasOutField ? parseHhMm(dto.checkOutAt) : row.checkOutAt;
    // Punch/edición de un solo lado: no inventar la otra hora con defaults.
    const partial =
      (hasInField && !hasOutField) ||
      (!hasInField && hasOutField) ||
      (hasInField &&
        hasOutField &&
        ((!!innVal && !outVal) || (!innVal && !!outVal)));
    const fill = opts?.fillMissingDefaults !== false && !partial;
    if (fill) {
      if (!row.checkInAt) row.checkInAt = defaults.checkIn;
      if (!row.checkOutAt) row.checkOutAt = defaults.checkOut;
    }
    if (row.checkInAt && row.checkOutAt) {
      row.overtimeHours = String(
        computeOvertimeHours({
          isPresent: true,
          checkInAt: row.checkInAt,
          checkOutAt: row.checkOutAt,
          defaultCheckIn: defaults.checkIn,
          defaultCheckOut: defaults.checkOut,
        }),
      );
    } else {
      row.overtimeHours = '0';
    }
  }

  /** Estado de fichaje de una fila (con o sin horas). */
  private punchState(
    row: AttendanceDay | null | undefined,
    withHours: boolean,
  ): 'empty' | 'inOnly' | 'complete' {
    if (!withHours) {
      return row?.isPresent ? 'complete' : 'empty';
    }
    const inn = String(row?.checkInAt ?? '').trim();
    const out = String(row?.checkOutAt ?? '').trim();
    if (inn && out) return 'complete';
    if (inn) return 'inOnly';
    return 'empty';
  }

  async upsertDay(
    user: AuthUser,
    shopId: string,
    dto: {
      employeeId: string;
      date: string;
      shiftId?: string | null;
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
    const { shop, shift } = await this.resolveAttendanceShift(shopId, dto.shiftId);
    const withHours = this.withHours(shop);
    const defaults = this.overtimeBaseline(shop ?? {}, emp, shift.id, dto.date);

    let row = await this.days.findOne({
      where: { employeeId: dto.employeeId, date: dto.date, shiftId: shift.id },
    });
    if (!row) {
      row = this.days.create({
        shopId,
        employeeId: dto.employeeId,
        date: dto.date,
        shiftId: shift.id,
        isPresent: false,
        isHoliday: false,
        overtimeHours: '0',
        checkInAt: null,
        checkOutAt: null,
        active: true,
      });
    }
    row.shiftId = shift.id;
    if (dto.isHoliday !== undefined) row.isHoliday = dto.isHoliday;
    this.applyShift(row, dto, defaults, withHours);
    await this.days.save(row);
    this.live.tick(shopId, 'attendance');
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
      shiftId?: string | null;
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

  async overtimeSummary(
    user: AuthUser,
    shopId: string,
    from: string,
    to: string,
    opts: {
      countAll?: boolean;
      countLateArrival?: boolean;
      countEarlyLeave?: boolean;
    } = {},
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!from || !to) throw new BadRequestException('Indicá from y to (YYYY-MM-DD)');
    const shop = await this.shops.getShopEntity(shopId);
    const withHours = this.withHours(shop);
    const countLateArrival = opts.countLateArrival ?? !!opts.countAll;
    const countEarlyLeave = opts.countEarlyLeave ?? !!opts.countAll;
    const employees = await this.listEmployees(shopId, 'active');
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
      const payDefaults = this.employeeShiftDefaults(shop ?? {}, e, null);
      const overtimeHours =
        Math.round(
          days.reduce((s, d) => {
            if (!d.isPresent) return s;
            if (withHours && d.checkInAt && d.checkOutAt) {
              const defaults = this.overtimeBaseline(shop ?? {}, e, d.shiftId, d.date);
              return (
                s +
                computeOvertimeHours({
                  isPresent: true,
                  checkInAt: d.checkInAt,
                  checkOutAt: d.checkOutAt,
                  defaultCheckIn: defaults.checkIn,
                  defaultCheckOut: defaults.checkOut,
                  countLateArrival,
                  countEarlyLeave,
                })
              );
            }
            return s + n(d.overtimeHours);
          }, 0) * 100,
        ) / 100;
      const presentDays = new Set(days.filter((d) => d.isPresent).map((d) => d.date)).size;
      const rate = resolveOvertimeHourRate(n(e.baseSalary), n(e.overtimeHourRate));
      const roundedRate = Math.round(rate * 100) / 100;
      return {
        employeeId: e.id,
        fullName: e.fullName,
        presentDays,
        overtimeHours,
        overtimeHourRate: roundedRate,
        overtimeCost: Math.round(overtimeHours * roundedRate * 100) / 100,
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
      countLateArrival,
      countEarlyLeave,
      countAll: countLateArrival && countEarlyLeave,
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

  async productionDaysForEmployees(
    shopId: string,
    employeeIds: string[],
    from: string,
    to: string,
  ) {
    if (!employeeIds.length) return [];
    return this.prodDays.find({
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

  private async requirePublicCheckInShop(slug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop || !shop.publicAttendanceCheckInEnabled) {
      throw new NotFoundException('Fichaje no disponible en este local');
    }
    return shop;
  }

  /** Bootstrap del kiosco (sin PIN): solo identidad del local. */
  async publicCheckInBootstrap(slug: string) {
    const shop = await this.requirePublicCheckInShop(slug);
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
        accentSecondary: shop.accentSecondary ?? null,
      },
    };
  }

  /** Fichar público por PIN (misma lógica que admin, sin employeeId). */
  async publicCheckIn(
    slug: string,
    pinRaw: string,
    opts?: {
      checkInAt?: string | null;
      checkOutAt?: string | null;
      shiftId?: string | null;
    },
  ) {
    const shop = await this.requirePublicCheckInShop(slug);
    const pin = String(pinRaw ?? '').trim();
    if (!/^\d{4}$/.test(pin)) {
      throw new UnauthorizedException('PIN incorrecto');
    }
    const hash = hashEmployeePin(pin);
    const employees = await this.employees.find({
      where: { shopId: shop.id, waiterPinHash: hash },
    });
    const employee = employees.find(
      (e) => isEntityActive(e.active) && employeeShowsInFichar(e),
    );
    if (!employee) throw new UnauthorizedException('PIN incorrecto');
    return this.punchAttendance(shop, employee, opts);
  }

  /** Fichar desde admin (sesión JWT): elige empleado, sin PIN. */
  async adminCheckIn(
    user: AuthUser,
    shopId: string,
    opts: {
      employeeId: string;
      checkInAt?: string | null;
      checkOutAt?: string | null;
      shiftId?: string | null;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop) throw new NotFoundException('Local no encontrado');
    const employee = await this.employees.findOne({
      where: { id: opts.employeeId, shopId },
    });
    if (!employee || !isEntityActive(employee.active) || !employeeShowsInFichar(employee)) {
      throw new NotFoundException('Empleado no encontrado');
    }
    return this.punchAttendance(shop, employee, {
      shiftId: opts.shiftId,
      checkInAt: opts.checkInAt,
      checkOutAt: opts.checkOutAt,
      /** Admin: fijos y rotativos del turno. El kiosco público sigue solo fijos. */
      includeRotating: true,
    });
  }

  /**
   * Empleados con fichaje pendiente hoy (entrada o salida faltante).
   * Para el kiosco admin (fijos y rotativos).
   */
  async adminCheckInPending(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop) throw new NotFoundException('Local no encontrado');
    const withHours = this.withHours(shop);
    const date = resolveShopBusinessDate(new Date(), {
      timezone: shop.timezone,
      openingTime: shop.openingTime,
    });
    const weekday = weekdayOf(date);
    const closed = Array.isArray(shop.closedWeekdays) ? shop.closedWeekdays : [];
    const shopPayload = {
      id: shop.id,
      name: shop.name,
      accentColor: shop.accentColor ?? null,
      accentSecondary: shop.accentSecondary ?? null,
      logoUrl: shop.logoUrl ?? null,
    };
    if (weekday != null && closed.includes(weekday)) {
      return { date, withHours, shop: shopPayload, employees: [] as const };
    }
    const allShifts = normalizeShopShifts(shop.shifts, shop.openingTime);
    const dayShifts = weekday == null ? allShifts : shiftsOnWeekday(allShifts, weekday);
    const employees = await this.listEmployees(shopId, 'active');
    const out: Array<{
      employeeId: string;
      fullName: string;
      shiftId: string;
      shiftName: string;
      employeeType: 'FIXED' | 'ROTATING';
      punchPhase: 'checkIn' | 'checkOut';
      checkInAt: string | null;
      checkOutAt: string | null;
      defaultCheckIn: string;
      defaultCheckOut: string;
    }> = [];
    for (const emp of employees) {
      if (!employeeShowsInFichar(emp)) continue;
      const eligible = dayShifts.filter((s) => employeeWorksShift(emp, s.id));
      if (!eligible.length) continue;
      const shiftIds = eligible.map((s) => s.id);
      const dayRows = await this.days.find({
        where: { employeeId: emp.id, date, shiftId: In(shiftIds) },
      });
      for (const s of eligible) {
        const row = dayRows.find((r) => r.shiftId === s.id) ?? null;
        if (row?.isHoliday && !row.isPresent) continue;
        const state = this.punchState(row, withHours);
        if (state === 'complete') continue;
        const defaults = this.overtimeBaseline(shop, emp, s.id, date);
        out.push({
          employeeId: emp.id,
          fullName: emp.fullName,
          shiftId: s.id,
          shiftName: s.name,
          employeeType: employeeTypeForShift(emp, s.id),
          punchPhase: state === 'inOnly' ? 'checkOut' : 'checkIn',
          checkInAt: row?.checkInAt ?? null,
          checkOutAt: row?.checkOutAt ?? null,
          defaultCheckIn: defaults.checkIn,
          defaultCheckOut: defaults.checkOut,
        });
      }
    }
    out.sort((a, b) => {
      const typeOrd = Number(a.employeeType === 'ROTATING') - Number(b.employeeType === 'ROTATING');
      if (typeOrd) return typeOrd;
      return (
        a.fullName.localeCompare(b.fullName, 'es') ||
        a.shiftName.localeCompare(b.shiftName, 'es')
      );
    });
    return {
      date,
      withHours,
      shop: shopPayload,
      employees: out,
    };
  }

  /**
   * Motor compartido: entrada y salida por separado (inmutable en kiosco).
   * Preview sin shiftId o sin la hora del paso; save con shiftId + hora del paso.
   */
  private async punchAttendance(
    shop: Shop,
    employee: Employee,
    opts?: {
      checkInAt?: string | null;
      checkOutAt?: string | null;
      shiftId?: string | null;
      /** Si true, incluye turnos rotativos (admin). Público: solo fijos. */
      includeRotating?: boolean;
    },
  ) {
    const date = resolveShopBusinessDate(new Date(), {
      timezone: shop.timezone,
      openingTime: shop.openingTime,
    });
    const weekday = weekdayOf(date);
    const closed = Array.isArray(shop.closedWeekdays) ? shop.closedWeekdays : [];
    if (weekday != null && closed.includes(weekday)) {
      throw new BadRequestException('No disponible');
    }

    const allShifts = normalizeShopShifts(shop.shifts, shop.openingTime);
    const dayShifts = weekday == null ? allShifts : shiftsOnWeekday(allShifts, weekday);
    const eligible = dayShifts.filter((s) =>
      opts?.includeRotating
        ? employeeWorksShift(employee, s.id)
        : employeeWorksFixedShift(employee, s.id),
    );
    if (!eligible.length) {
      throw new BadRequestException('No disponible');
    }

    const withHours = this.withHours(shop);
    const shiftIds = eligible.map((s) => s.id);
    const dayRows = await this.days.find({
      where: { employeeId: employee.id, date, shiftId: In(shiftIds) },
    });

    const pending = eligible.filter((s) => {
      const row = dayRows.find((r) => r.shiftId === s.id);
      return this.punchState(row, withHours) !== 'complete';
    });

    if (!pending.length) {
      const done = dayRows.filter((r) => this.punchState(r, withHours) === 'complete');
      const first = done[0];
      return {
        ok: true as const,
        status: 'alreadyMarked' as const,
        alreadyMarked: true,
        date,
        checkInAt: first?.checkInAt ?? null,
        checkOutAt: first?.checkOutAt ?? null,
        marks: done.map((r) => ({
          shiftId: r.shiftId,
          checkInAt: r.checkInAt ?? null,
          checkOutAt: r.checkOutAt ?? null,
        })),
      };
    }

    const current = resolveCurrentShift(allShifts, new Date(), shop.timezone);
    const defaultShift = pending.find((s) => s.id === current.id) ?? pending[0];
    const requestedId = String(opts?.shiftId ?? '').trim();
    const targetShift = requestedId
      ? pending.find((s) => s.id === requestedId)
      : defaultShift;
    if (!targetShift) {
      throw new BadRequestException('Turno no disponible');
    }

    let row = dayRows.find((r) => r.shiftId === targetShift.id) ?? null;
    if (row?.isHoliday && !row.isPresent) {
      throw new BadRequestException('No disponible');
    }

    const state = this.punchState(row, withHours);
    if (state === 'complete') {
      return {
        ok: true as const,
        status: 'alreadyMarked' as const,
        alreadyMarked: true,
        date,
        checkInAt: row?.checkInAt ?? null,
        checkOutAt: row?.checkOutAt ?? null,
        marks: [
          {
            shiftId: row!.shiftId,
            checkInAt: row!.checkInAt ?? null,
            checkOutAt: row!.checkOutAt ?? null,
          },
        ],
      };
    }

    const punchPhase: 'checkIn' | 'checkOut' = state === 'inOnly' ? 'checkOut' : 'checkIn';
    const defaults = this.overtimeBaseline(shop, employee, targetShift.id, date);

    const shiftOptions = pending.map((s) => {
      const r = dayRows.find((d) => d.shiftId === s.id);
      const st = this.punchState(r, withHours);
      const d = this.overtimeBaseline(shop, employee, s.id, date);
      return {
        id: s.id,
        name: s.name,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
        punchPhase: (st === 'inOnly' ? 'checkOut' : 'checkIn') as 'checkIn' | 'checkOut',
        checkInAt: r?.checkInAt ?? d.checkIn,
        checkOutAt: r?.checkOutAt ?? d.checkOut,
        recordedCheckInAt: r?.checkInAt ?? null,
        recordedCheckOutAt: r?.checkOutAt ?? null,
      };
    });

    const rawIn = String(opts?.checkInAt ?? '').trim();
    const rawOut = String(opts?.checkOutAt ?? '').trim();
    const hasIn = !!rawIn;
    const hasOut = !!rawOut;

    const isSave =
      !!requestedId &&
      (!withHours || (punchPhase === 'checkIn' ? hasIn : hasOut));

    if (!isSave) {
      return {
        ok: true as const,
        status: (punchPhase === 'checkIn' ? 'needsCheckIn' : 'needsCheckOut') as
          | 'needsCheckIn'
          | 'needsCheckOut',
        needsTimes: true as const,
        punchPhase,
        alreadyMarked: false,
        date,
        withHours,
        defaultShiftId: defaultShift.id,
        shiftId: targetShift.id,
        shifts: shiftOptions,
        checkInAt: punchPhase === 'checkIn' ? defaults.checkIn : row?.checkInAt ?? null,
        checkOutAt: punchPhase === 'checkOut' ? defaults.checkOut : row?.checkOutAt ?? null,
      };
    }

    if (withHours) {
      if (punchPhase === 'checkIn') {
        if (hasOut && !hasIn) {
          throw new BadRequestException('Primero registrá la entrada');
        }
        if (row?.checkInAt) {
          throw new BadRequestException('La entrada ya está registrada');
        }
      } else {
        if (hasIn) {
          throw new BadRequestException('La entrada ya está registrada y no se puede cambiar');
        }
        if (!row?.checkInAt) {
          throw new BadRequestException('Primero registrá la entrada');
        }
        if (row.checkOutAt) {
          throw new BadRequestException('La salida ya está registrada');
        }
      }
    }

    if (!row) {
      row = this.days.create({
        shopId: shop.id,
        employeeId: employee.id,
        date,
        shiftId: targetShift.id,
        isPresent: false,
        isHoliday: false,
        overtimeHours: '0',
        checkInAt: null,
        checkOutAt: null,
        active: true,
      });
    }
    row.shiftId = targetShift.id;

    if (!withHours) {
      this.applyShift(row, { isPresent: true }, defaults, withHours);
      await this.days.save(row);
      this.live.tick(shop.id, 'attendance');
      void this.notifyCheckInAdmins(shop.id, shop.name, {
        displayName: employee.fullName,
        date,
        shiftName: targetShift.name,
        checkInAt: null,
        checkOutAt: null,
        kind: 'present',
      }).catch(() => undefined);
      return {
        ok: true as const,
        status: 'complete' as const,
        alreadyMarked: false,
        date,
        checkInAt: null,
        checkOutAt: null,
        marks: [
          {
            shiftId: row.shiftId,
            checkInAt: null,
            checkOutAt: null,
          },
        ],
      };
    }

    if (punchPhase === 'checkIn') {
      const checkInAt = parseHhMm(rawIn);
      if (!checkInAt) throw new BadRequestException('Horario inválido');
      this.applyShift(
        row,
        { isPresent: true, checkInAt, checkOutAt: undefined },
        defaults,
        withHours,
      );
      await this.days.save(row);
      this.live.tick(shop.id, 'attendance');
      void this.notifyCheckInAdmins(shop.id, shop.name, {
        displayName: employee.fullName,
        date,
        shiftName: targetShift.name,
        checkInAt,
        checkOutAt: null,
        kind: 'checkIn',
      }).catch(() => undefined);
      return {
        ok: true as const,
        status: 'needsCheckOut' as const,
        alreadyMarked: false,
        punchPhase: 'checkOut' as const,
        date,
        checkInAt,
        checkOutAt: null,
        marks: [
          {
            shiftId: row.shiftId,
            checkInAt,
            checkOutAt: null,
          },
        ],
      };
    }

    const checkOutAt = parseHhMm(rawOut);
    if (!checkOutAt) throw new BadRequestException('Horario inválido');
    this.applyShift(
      row,
      { isPresent: true, checkOutAt, checkInAt: undefined },
      defaults,
      withHours,
    );
    await this.days.save(row);
    this.live.tick(shop.id, 'attendance');
    void this.notifyCheckInAdmins(shop.id, shop.name, {
      displayName: employee.fullName,
      date,
      shiftName: targetShift.name,
      checkInAt: row.checkInAt ?? null,
      checkOutAt,
      kind: 'checkOut',
    }).catch(() => undefined);
    return {
      ok: true as const,
      status: 'complete' as const,
      alreadyMarked: false,
      date,
      checkInAt: row.checkInAt ?? null,
      checkOutAt,
      marks: [
        {
          shiftId: row.shiftId,
          checkInAt: row.checkInAt ?? null,
          checkOutAt,
        },
      ],
    };
  }

  private async notifyCheckInAdmins(
    shopId: string,
    shopName: string,
    opts: {
      displayName: string;
      date: string;
      shiftName: string;
      checkInAt?: string | null;
      checkOutAt?: string | null;
      kind?: 'checkIn' | 'checkOut' | 'present';
    },
  ) {
    const links = await this.userShops.find({ where: { shopId } });
    const userIds = [
      ...new Set(links.filter((l) => !!l.isAttendanceCheckInAdmin).map((l) => l.userId)),
    ];
    if (!userIds.length) return;
    const name = String(opts.displayName ?? '').trim() || 'Empleado';
    const shift = String(opts.shiftName ?? '').trim() || 'turno';
    let detail = '';
    if (opts.kind === 'checkIn' && opts.checkInAt) detail = ` · entrada ${opts.checkInAt}`;
    else if (opts.kind === 'checkOut' && opts.checkOutAt) {
      detail = opts.checkInAt
        ? ` · ${opts.checkInAt}–${opts.checkOutAt}`
        : ` · salida ${opts.checkOutAt}`;
    } else if (opts.checkInAt && opts.checkOutAt) {
      detail = ` · ${opts.checkInAt}–${opts.checkOutAt}`;
    }
    const verb =
      opts.kind === 'checkIn'
        ? 'marcó entrada'
        : opts.kind === 'checkOut'
          ? 'marcó salida'
          : 'fichó';
    await this.notifications.createMany(
      userIds.map((userId) => ({
        userId,
        shopId,
        type: NotificationType.ATTENDANCE_CHECK_IN,
        title: 'Fichaje registrado',
        body: `${shopName}: ${name} ${verb} ${shift} (${opts.date})${detail}`,
      })),
    );
  }

  async publicEmployeeList(slug: string) {
    const shop = await this.requirePublicAttendanceShop(slug);
    const employees = await this.listEmployees(shop.id, 'active');
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
    const employees = await this.listEmployees(shop.id, 'active');
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
        checkInAt: string | null;
        checkOutAt: string | null;
      }
    > = {};
    for (const d of rows) {
      days[d.date] = {
        isPresent: !!d.isPresent,
        isHoliday: !!d.isHoliday,
        overtimeHours: n(d.overtimeHours),
        hours: emp.producesFood ? (prodByDate.get(d.date) ?? 0) : null,
        checkInAt: d.checkInAt ?? null,
        checkOutAt: d.checkOutAt ?? null,
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
            checkInAt: null,
            checkOutAt: null,
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
