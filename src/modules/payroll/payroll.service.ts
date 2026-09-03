import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { PayrollPeriod } from '../../entities/payroll-period.entity';
import { PayrollLine } from '../../entities/payroll-line.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { PayrollStatus } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import {
  resolveOvertimeHourRate,
  scheduledShiftHours,
} from '../../common/shift-hours.util';
import {
  employeeWorksShift,
  shiftServiceSchedule,
  shiftWindowFallback,
} from '../../common/employee-shift.util';
import { normalizeShopShifts } from '../../common/shop-shifts';
import { ShopsService } from '../shops/shops.service';
import { AttendanceService } from '../attendance/attendance.service';
import { countCompletedAttendanceWeeks } from '../../common/shop-open-days';
import { AttendanceDay } from '../../entities/attendance-day.entity';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Default presentismo semanal si no se envía al generar. */
const DEFAULT_ATTENDANCE_BONUS = 50000;

@Injectable()
export class PayrollService implements OnModuleInit {
  constructor(
    @InjectRepository(PayrollPeriod)
    private readonly periods: Repository<PayrollPeriod>,
    @InjectRepository(PayrollLine) private readonly lines: Repository<PayrollLine>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
    private readonly attendance: AttendanceService,
  ) {}

  async onModuleInit() {
    try {
      await this.lines.query(`
        ALTER TABLE payroll_lines
          ADD COLUMN holidayMultiplierSnapshot DECIMAL(4,2) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.periods.query(`
        ALTER TABLE payroll_periods
          ADD COLUMN fromDate DATE NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.periods.query(`
        ALTER TABLE payroll_periods
          ADD COLUMN toDate DATE NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.periods.query(`
        UPDATE payroll_periods
        SET
          fromDate = DATE(CONCAT(year, '-', LPAD(month, 2, '0'), '-01')),
          toDate = LAST_DAY(DATE(CONCAT(year, '-', LPAD(month, 2, '0'), '-01')))
        WHERE fromDate IS NULL OR toDate IS NULL
      `);
    } catch {
      // ignore
    }
    try {
      await this.periods.query(`
        ALTER TABLE payroll_periods
          ADD COLUMN attendanceBonusAmount DECIMAL(14,2) NOT NULL DEFAULT 50000
      `);
    } catch {
      // ya existe
    }
    try {
      await this.periods.query(`
        ALTER TABLE payroll_periods
          ADD COLUMN attendanceBonusMinDays INT NOT NULL DEFAULT 21
      `);
    } catch {
      // ya existe
    }
    try {
      await this.periods.query(`
        ALTER TABLE payroll_periods
          ADD COLUMN splitByShift TINYINT NOT NULL DEFAULT 0
      `);
    } catch {
      // ya existe
    }
    try {
      await this.lines.query(`
        ALTER TABLE payroll_lines
          ADD COLUMN shiftId VARCHAR(36) NOT NULL DEFAULT ''
      `);
    } catch {
      // ya existe
    }
    try {
      await this.lines.query(`
        ALTER TABLE payroll_lines
          ADD COLUMN shiftName VARCHAR(80) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.lines.query(`
        ALTER TABLE payroll_lines
          ADD COLUMN hoursWorked DECIMAL(10,2) NOT NULL DEFAULT 0
      `);
    } catch {
      // ya existe
    }
    // Índices simples para las FK, así MySQL deja dropear el unique (periodId, employeeId).
    for (const sql of [
      `CREATE INDEX IDX_payroll_lines_periodId ON payroll_lines (periodId)`,
      `CREATE INDEX IDX_payroll_lines_employeeId ON payroll_lines (employeeId)`,
    ]) {
      try {
        await this.lines.query(sql);
      } catch {
        // ya existe
      }
    }
    for (const idx of [
      'IDX_4568f819e95fbe0d30006eaaa3', // unique viejo (periodId, employeeId)
      'IDX_6a06c16164120e19a0f8634bc9',
      'REL_payroll_lines_period_employee',
      'UQ_payroll_lines_periodId_employeeId',
      'IDX_payroll_lines_period_employee',
    ]) {
      try {
        await this.lines.query(`ALTER TABLE payroll_lines DROP INDEX \`${idx}\``);
      } catch {
        // no estaba
      }
    }
    try {
      // Drop unique on (periodId, employeeId) if TypeORM named it differently
      const rows: Array<{ INDEX_NAME: string }> = await this.lines.query(`
        SELECT DISTINCT INDEX_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'payroll_lines'
          AND NON_UNIQUE = 0
          AND COLUMN_NAME IN ('periodId', 'employeeId')
          AND INDEX_NAME <> 'PRIMARY'
          AND INDEX_NAME <> 'uq_payroll_lines_period_emp_shift'
      `);
      const names = [...new Set(rows.map((r) => r.INDEX_NAME))];
      for (const name of names) {
        const cols: Array<{ COLUMN_NAME: string }> = await this.lines.query(
          `
          SELECT COLUMN_NAME
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'payroll_lines'
            AND INDEX_NAME = ?
          ORDER BY SEQ_IN_INDEX
          `,
          [name],
        );
        const colNames = cols.map((c) => c.COLUMN_NAME);
        if (
          colNames.length === 2 &&
          colNames[0] === 'periodId' &&
          colNames[1] === 'employeeId'
        ) {
          try {
            await this.lines.query(`ALTER TABLE payroll_lines DROP INDEX \`${name}\``);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    try {
      await this.lines.query(`
        ALTER TABLE payroll_lines
          ADD UNIQUE INDEX uq_payroll_lines_period_emp_shift (periodId, employeeId, shiftId)
      `);
    } catch {
      // ya existe
    }
  }

  private resolveAttendanceBonusAmount(amountRaw?: number | null) {
    if (amountRaw == null || Number.isNaN(Number(amountRaw))) {
      return DEFAULT_ATTENDANCE_BONUS;
    }
    return Math.max(0, Number(amountRaw));
  }

  private monthRange(year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to };
  }

  private parseRange(from: string, to: string) {
    const f = String(from ?? '').trim();
    const t = String(to ?? '').trim();
    if (!DATE_RE.test(f) || !DATE_RE.test(t)) {
      throw new BadRequestException('Indicá from y to (YYYY-MM-DD)');
    }
    if (f > t) throw new BadRequestException('La fecha desde no puede ser posterior a hasta');
    const year = Number(f.slice(0, 4));
    const month = Number(f.slice(5, 7));
    return { from: f, to: t, year, month };
  }

  private emptyDto(shopId: string, from: string, to: string, year: number, month: number) {
    return {
      id: null,
      shopId,
      year,
      month,
      fromDate: from,
      toDate: to,
      status: PayrollStatus.DRAFT,
      attendanceBonusAmount: DEFAULT_ATTENDANCE_BONUS,
      splitByShift: false,
      lines: [],
    };
  }

  private shopHolidayMult(shop: Shop | null | undefined): number {
    const v = n(shop?.holidayPayMultiplier);
    return v > 0 ? v : 1;
  }

  private employeeHolidayMult(emp: Employee, shop: Shop | null | undefined): number {
    if (emp.holidayPayMultiplier != null && emp.holidayPayMultiplier !== '') {
      const v = n(emp.holidayPayMultiplier);
      if (v > 0) return v;
    }
    return this.shopHolidayMult(shop);
  }

  private toDto(period: PayrollPeriod) {
    const fromDate = period.fromDate || this.monthRange(period.year, period.month).from;
    const toDate = period.toDate || this.monthRange(period.year, period.month).to;
    return {
      id: period.id,
      shopId: period.shopId,
      year: period.year,
      month: period.month,
      fromDate,
      toDate,
      status: period.status,
      attendanceBonusAmount:
        period.attendanceBonusAmount == null || period.attendanceBonusAmount === ''
          ? DEFAULT_ATTENDANCE_BONUS
          : n(period.attendanceBonusAmount),
      splitByShift: !!period.splitByShift,
      lines: (period.lines ?? []).map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        employeeName: l.employee?.fullName ?? null,
        shiftId: l.shiftId || null,
        shiftName: l.shiftName ?? null,
        daysWorked: n(l.daysWorked),
        hoursWorked: n(l.hoursWorked),
        holidayDays: n(l.holidayDays),
        baseSalarySnapshot: n(l.baseSalarySnapshot),
        holidayMultiplierSnapshot:
          l.holidayMultiplierSnapshot == null || l.holidayMultiplierSnapshot === ''
            ? null
            : n(l.holidayMultiplierSnapshot),
        overtimeAmount: n(l.overtimeAmount),
        attendanceBonus: n(l.attendanceBonus),
        total: n(l.total),
        notes: l.notes ?? null,
      })),
    };
  }

  private async findByRange(shopId: string, from: string, to: string) {
    const exact = await this.periods.findOne({
      where: { shopId, fromDate: from, toDate: to },
      relations: ['lines', 'lines.employee'],
    });
    if (exact) return exact;
    const year = Number(from.slice(0, 4));
    const month = Number(from.slice(5, 7));
    const byMonth = await this.periods.findOne({
      where: { shopId, year, month },
      relations: ['lines', 'lines.employee'],
    });
    if (!byMonth) return null;
    const pFrom = byMonth.fromDate || this.monthRange(byMonth.year, byMonth.month).from;
    const pTo = byMonth.toDate || this.monthRange(byMonth.year, byMonth.month).to;
    if (pFrom === from && pTo === to) return byMonth;
    return null;
  }

  private async findOrCreateSlot(
    shopId: string,
    range: { from: string; to: string; year: number; month: number },
  ) {
    let period = await this.periods.findOne({
      where: { shopId, fromDate: range.from, toDate: range.to },
      relations: ['lines'],
    });
    if (!period) {
      period = await this.periods.findOne({
        where: { shopId, year: range.year, month: range.month },
        relations: ['lines'],
      });
    }
    return period;
  }

  async getByRange(user: AuthUser, shopId: string, from: string, to: string) {
    this.shops.assertShopAccess(user, shopId);
    const range = this.parseRange(from, to);
    const period = await this.findByRange(shopId, range.from, range.to);
    if (!period) {
      return this.emptyDto(shopId, range.from, range.to, range.year, range.month);
    }
    return this.toDto(period);
  }

  /** Compat: mes calendario completo. */
  async get(user: AuthUser, shopId: string, year: number, month: number) {
    const { from, to } = this.monthRange(year, month);
    return this.getByRange(user, shopId, from, to);
  }

  private buildLineAmounts(
    empDays: AttendanceDay[],
    emp: Employee,
    shop: Shop | null | undefined,
    range: { from: string; to: string },
    bonusAmount: number,
    includePresentismo: boolean,
    filterShiftId?: string | null,
  ) {
    const shifts = normalizeShopShifts(shop?.shifts, shop?.openingTime);
    const days =
      filterShiftId != null && filterShiftId !== ''
        ? empDays.filter((d) => d.shiftId === filterShiftId)
        : empDays;

    const scheduledHoursForDay = (day: AttendanceDay) => {
      const schedule = shiftServiceSchedule(
        emp,
        day.shiftId,
        shiftWindowFallback(shifts, day.shiftId),
      );
      return scheduledShiftHours(schedule.checkIn, schedule.checkOut);
    };

    let regularHours = 0;
    let holidayHours = 0;
    for (const d of days) {
      const hrs = scheduledHoursForDay(d);
      if (d.isHoliday) {
        holidayHours += hrs;
      } else if (d.isPresent) {
        regularHours += hrs;
      }
    }
    regularHours = Math.round(regularHours * 100) / 100;
    holidayHours = Math.round(holidayHours * 100) / 100;

    const presentDates = new Set(
      days.filter((d) => d.isPresent && !d.isHoliday).map((d) => d.date),
    );
    const daysWorked = presentDates.size;
    const holidayDays = new Set(days.filter((d) => d.isHoliday).map((d) => d.date)).size;
    const coveredDates = new Set<string>([
      ...presentDates,
      ...days.filter((d) => d.isHoliday).map((d) => d.date),
    ]);
    const completedWeeks =
      !includePresentismo || emp.countsForAttendanceBonus === false
        ? 0
        : countCompletedAttendanceWeeks(
            range.from,
            range.to,
            shop?.closedWeekdays,
            coveredDates,
          );
    const overtimeHours = days.reduce((s, d) => s + n(d.overtimeHours), 0);
    const hourlyRate = n(emp.baseSalary);
    const mult = this.employeeHolidayMult(emp, shop);
    const hourRate = resolveOvertimeHourRate(hourlyRate, n(emp.overtimeHourRate));
    const salaryPart =
      hourlyRate * regularHours + hourlyRate * holidayHours * mult;
    const overtimeAmount = hourRate * overtimeHours;
    const bonus = bonusAmount > 0 ? bonusAmount * completedWeeks : 0;
    return {
      daysWorked,
      holidayDays,
      regularHours,
      holidayHours,
      hourlyRate,
      mult,
      overtimeAmount,
      bonus,
      total: salaryPart + overtimeAmount + bonus,
    };
  }

  async generateByRange(
    user: AuthUser,
    shopId: string,
    from: string,
    to: string,
    includeInactive = false,
    bonusOpts?: {
      attendanceBonusAmount?: number | null;
      splitByShift?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const range = this.parseRange(from, to);
    const bonusAmount = this.resolveAttendanceBonusAmount(bonusOpts?.attendanceBonusAmount);
    const splitByShift = !!bonusOpts?.splitByShift;

    let period = await this.findOrCreateSlot(shopId, range);
    if (period?.status === PayrollStatus.LOCKED) {
      period.status = PayrollStatus.DRAFT;
      await this.periods.save(period);
    }

    if (!period) {
      period = await this.periods.save(
        this.periods.create({
          shopId,
          year: range.year,
          month: range.month,
          fromDate: range.from,
          toDate: range.to,
          status: PayrollStatus.DRAFT,
          attendanceBonusAmount: money(bonusAmount),
          splitByShift,
          active: true,
        }),
      );
    } else {
      period.year = range.year;
      period.month = range.month;
      period.fromDate = range.from;
      period.toDate = range.to;
      period.attendanceBonusAmount = money(bonusAmount);
      period.splitByShift = splitByShift;
      await this.periods.save(period);
    }

    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const shopShifts = normalizeShopShifts(shop?.shifts, shop?.openingTime);
    const allEmployees = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    const employees = includeInactive
      ? allEmployees
      : allEmployees.filter((e) => isEntityActive(e.active));
    const days = await this.attendance.daysForEmployees(
      shopId,
      employees.map((e) => e.id),
      range.from,
      range.to,
    );

    await this.lines.delete({ periodId: period.id });

    const created: PayrollLine[] = [];
    for (const emp of employees) {
      const empDaysAll = days.filter((d) => d.employeeId === emp.id);

      if (!splitByShift) {
        const amounts = this.buildLineAmounts(
          empDaysAll,
          emp,
          shop,
          range,
          bonusAmount,
          true,
        );
        created.push(
          this.lines.create({
            periodId: period.id,
            employeeId: emp.id,
            shiftId: '',
            shiftName: null,
            daysWorked: String(amounts.daysWorked),
            hoursWorked: String(amounts.regularHours),
            holidayDays: String(amounts.holidayDays),
            baseSalarySnapshot: money(amounts.hourlyRate),
            holidayMultiplierSnapshot: amounts.mult.toFixed(2),
            overtimeAmount: money(amounts.overtimeAmount),
            attendanceBonus: money(amounts.bonus),
            total: money(amounts.total),
            active: true,
          }),
        );
        continue;
      }

      let targets = shopShifts.filter((s) => employeeWorksShift(emp, s.id));
      if (!targets.length) {
        const dayShiftIds = [
          ...new Set(empDaysAll.map((d) => d.shiftId).filter((id): id is string => !!id)),
        ];
        targets = shopShifts.filter((s) => dayShiftIds.includes(s.id));
        if (!targets.length && shopShifts[0]) targets = [shopShifts[0]];
      }

      // Presentismo es por persona (días hábiles del local); va en la 1ª línea del empleado.
      const personPresentismo = this.buildLineAmounts(
        empDaysAll,
        emp,
        shop,
        range,
        bonusAmount,
        true,
      ).bonus;

      targets.forEach((shift, idx) => {
        const empDays = empDaysAll.filter((d) => d.shiftId === shift.id);
        const amounts = this.buildLineAmounts(
          empDays,
          emp,
          shop,
          range,
          bonusAmount,
          false,
          shift.id,
        );
        const bonus = idx === 0 ? personPresentismo : 0;
        const total =
          amounts.hourlyRate * amounts.regularHours +
          amounts.hourlyRate * amounts.holidayHours * amounts.mult +
          amounts.overtimeAmount +
          bonus;
        created.push(
          this.lines.create({
            periodId: period.id,
            employeeId: emp.id,
            shiftId: shift.id,
            shiftName: shift.name,
            daysWorked: String(amounts.daysWorked),
            hoursWorked: String(amounts.regularHours),
            holidayDays: String(amounts.holidayDays),
            baseSalarySnapshot: money(amounts.hourlyRate),
            holidayMultiplierSnapshot: amounts.mult.toFixed(2),
            overtimeAmount: money(amounts.overtimeAmount),
            attendanceBonus: money(bonus),
            total: money(total),
            active: true,
          }),
        );
      });
    }
    if (created.length) await this.lines.save(created);

    return this.getByRange(user, shopId, range.from, range.to);
  }

  async generate(
    user: AuthUser,
    shopId: string,
    year: number,
    month: number,
    includeInactive = false,
  ) {
    if (month < 1 || month > 12) throw new BadRequestException('Mes inválido');
    const { from, to } = this.monthRange(year, month);
    return this.generateByRange(user, shopId, from, to, includeInactive);
  }

  /** SAC: mitad del mejor sueldo (línea total) del semestre. */
  async sac(user: AuthUser, shopId: string, year: number, semester: 1 | 2) {
    this.shops.assertShopAccess(user, shopId);
    const months = semester === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
    const employees = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    const periods = await this.periods.find({
      where: { shopId, year },
      relations: ['lines'],
    });
    const relevant = periods.filter((p) => months.includes(p.month));

    return {
      shopId,
      year,
      semester,
      employees: employees
        .filter((emp) => isEntityActive(emp.active))
        .map((emp) => {
          const totals: number[] = [];
          for (const p of relevant) {
            const empLines = (p.lines ?? []).filter((l) => l.employeeId === emp.id);
            if (empLines.length) {
              totals.push(empLines.reduce((sum, l) => sum + n(l.total), 0));
            }
          }
          const best = totals.length ? Math.max(...totals) : 0;
          const monthsWorked = totals.length;
          const sacAmount = (best / 2) * (monthsWorked / 6);
          return {
            employeeId: emp.id,
            fullName: emp.fullName,
            bestSalary: best,
            monthsWorked,
            sacAmount,
          };
        }),
    };
  }

  async exportPeriodXlsxByRange(user: AuthUser, shopId: string, from: string, to: string) {
    const period = await this.getByRange(user, shopId, from, to);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Liquidación');
    ws.addRow([
      'Empleado',
      'Turno',
      'Días trabajados',
      'Horas trabajadas',
      'Feriados',
      '$ / hora',
      'Horas extra ($)',
      'Presentismo',
      'Total',
    ]);
    for (const l of period.lines) {
      ws.addRow([
        l.employeeName ?? '',
        l.shiftName || 'Todos',
        l.daysWorked,
        l.hoursWorked,
        l.holidayDays,
        l.baseSalarySnapshot,
        l.overtimeAmount,
        l.attendanceBonus,
        l.total,
      ]);
    }
    ws.getRow(1).font = { bold: true };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = (shop?.slug || shop?.name || 'local')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return { buffer, filename: `liquidacion-${slug}-${from}_${to}.xlsx` };
  }

  async exportPeriodXlsx(user: AuthUser, shopId: string, year: number, month: number) {
    const { from, to } = this.monthRange(year, month);
    return this.exportPeriodXlsxByRange(user, shopId, from, to);
  }

  async listInRange(shopId: string, from: string, to: string) {
    const periods = await this.periods.find({
      where: { shopId },
      relations: ['lines', 'lines.employee'],
      order: { fromDate: 'ASC', year: 'ASC', month: 'ASC' },
    });
    return periods.filter((p) => {
      const pFrom = p.fromDate || this.monthRange(p.year, p.month).from;
      const pTo = p.toDate || this.monthRange(p.year, p.month).to;
      return pFrom <= to && pTo >= from;
    });
  }
}
