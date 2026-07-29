import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayrollPeriod } from '../../entities/payroll-period.entity';
import { PayrollLine } from '../../entities/payroll-line.entity';
import { Employee } from '../../entities/employee.entity';
import { AuthUser } from '../../common/decorators';
import { PayrollStatus } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { AttendanceService } from '../attendance/attendance.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

/** Valor hora extra = sueldo / 21 / 8 (aprox. jornada). Bonus presentismo fijo configurable. */
const ATTENDANCE_BONUS = 50000;
const WORK_DAYS_BASE = 21;

@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(PayrollPeriod)
    private readonly periods: Repository<PayrollPeriod>,
    @InjectRepository(PayrollLine) private readonly lines: Repository<PayrollLine>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    private readonly shops: ShopsService,
    private readonly attendance: AttendanceService,
  ) {}

  private monthRange(year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to };
  }

  private toDto(period: PayrollPeriod) {
    return {
      id: period.id,
      shopId: period.shopId,
      year: period.year,
      month: period.month,
      status: period.status,
      lines: (period.lines ?? []).map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        employeeName: l.employee?.fullName ?? null,
        daysWorked: n(l.daysWorked),
        holidayDays: n(l.holidayDays),
        baseSalarySnapshot: n(l.baseSalarySnapshot),
        overtimeAmount: n(l.overtimeAmount),
        attendanceBonus: n(l.attendanceBonus),
        total: n(l.total),
        notes: l.notes ?? null,
      })),
    };
  }

  async get(user: AuthUser, shopId: string, year: number, month: number) {
    this.shops.assertShopAccess(user, shopId);
    const period = await this.periods.findOne({
      where: { shopId, year, month },
      relations: ['lines', 'lines.employee'],
    });
    if (!period) {
      return {
        id: null,
        shopId,
        year,
        month,
        status: PayrollStatus.DRAFT,
        lines: [],
      };
    }
    return this.toDto(period);
  }

  async generate(user: AuthUser, shopId: string, year: number, month: number) {
    this.shops.assertShopAccess(user, shopId);
    if (month < 1 || month > 12) throw new BadRequestException('Mes inválido');

    let period = await this.periods.findOne({
      where: { shopId, year, month },
      relations: ['lines'],
    });
    if (period?.status === PayrollStatus.LOCKED) {
      throw new BadRequestException('La liquidación está cerrada');
    }

    if (!period) {
      period = await this.periods.save(
        this.periods.create({
          shopId,
          year,
          month,
          status: PayrollStatus.DRAFT,
          active: true,
        }),
      );
    }

    const employees = await this.employees.find({
      where: { shopId, active: true },
      order: { fullName: 'ASC' },
    });
    const { from, to } = this.monthRange(year, month);
    const days = await this.attendance.daysForEmployees(
      shopId,
      employees.map((e) => e.id),
      from,
      to,
    );

    await this.lines.delete({ periodId: period.id });

    const created: PayrollLine[] = [];
    for (const emp of employees) {
      const empDays = days.filter((d) => d.employeeId === emp.id);
      const daysWorked = empDays.filter((d) => d.isPresent).length;
      const holidayDays = empDays.filter((d) => d.isHoliday).length;
      const overtimeHours = empDays.reduce((s, d) => s + n(d.overtimeHours), 0);
      const base = n(emp.baseSalary);
      const daily = base / WORK_DAYS_BASE;
      const hourRate = daily / 8;
      const salaryPart = daily * (daysWorked + holidayDays);
      const overtimeAmount = hourRate * overtimeHours;
      const bonus =
        daysWorked + holidayDays >= WORK_DAYS_BASE ? ATTENDANCE_BONUS : 0;
      const total = salaryPart + overtimeAmount + bonus;

      created.push(
        this.lines.create({
          periodId: period.id,
          employeeId: emp.id,
          daysWorked: String(daysWorked),
          holidayDays: String(holidayDays),
          baseSalarySnapshot: money(base),
          overtimeAmount: money(overtimeAmount),
          attendanceBonus: money(bonus),
          total: money(total),
          active: true,
        }),
      );
    }
    if (created.length) await this.lines.save(created);

    return this.get(user, shopId, year, month);
  }

  async lock(user: AuthUser, shopId: string, year: number, month: number) {
    this.shops.assertShopAccess(user, shopId);
    const period = await this.periods.findOne({ where: { shopId, year, month } });
    if (!period) throw new NotFoundException('No hay liquidación para ese período');
    period.status = PayrollStatus.LOCKED;
    await this.periods.save(period);
    return this.get(user, shopId, year, month);
  }

  /** SAC: mitad del mejor sueldo (línea total) del semestre. */
  async sac(user: AuthUser, shopId: string, year: number, semester: 1 | 2) {
    this.shops.assertShopAccess(user, shopId);
    const months = semester === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
    const employees = await this.employees.find({
      where: { shopId, active: true },
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
      employees: employees.map((emp) => {
        const totals: number[] = [];
        for (const p of relevant) {
          const line = (p.lines ?? []).find((l) => l.employeeId === emp.id);
          if (line) totals.push(n(line.total));
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

  async listInRange(shopId: string, from: string, to: string) {
    const fromY = Number(from.slice(0, 4));
    const fromM = Number(from.slice(5, 7));
    const toY = Number(to.slice(0, 4));
    const toM = Number(to.slice(5, 7));
    const periods = await this.periods.find({
      where: { shopId },
      relations: ['lines', 'lines.employee'],
      order: { year: 'ASC', month: 'ASC' },
    });
    return periods.filter((p) => {
      const key = p.year * 100 + p.month;
      return key >= fromY * 100 + fromM && key <= toY * 100 + toM;
    });
  }
}
