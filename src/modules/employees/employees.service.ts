import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Employee, EmployeeType } from '../../entities/employee.entity';
import { SalaryHistorySource } from '../../entities/employee-salary-history.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { parseHhMm } from '../../common/shift-hours.util';
import {
  deriveEmployeeType,
  normalizeEmployeeType,
  normalizeShiftAssignments,
  type EmployeeShiftAssignment,
} from '../../common/employee-shift.util';
import { normalizeShopShifts } from '../../common/shop-shifts';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { ShopsService } from '../shops/shops.service';
import { SalariesService } from '../payroll/salaries.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class EmployeesService implements OnModuleInit {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly live: ShopLiveService,
    @Inject(forwardRef(() => SalariesService))
    private readonly salaries: SalariesService,
  ) {}

  async onModuleInit() {
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN type ENUM('FIXED', 'ROTATING') NOT NULL DEFAULT 'FIXED'
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN producesFood TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN supervisorEmployeeId CHAR(36) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN bankAlias VARCHAR(120) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN overtimeHourRate DECIMAL(12,2) NOT NULL DEFAULT 0.00
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN serviceCheckIn VARCHAR(5) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN serviceCheckOut VARCHAR(5) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN holidayPayMultiplier DECIMAL(4,2) NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN shiftAssignments TEXT NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.employees.query(`
        ALTER TABLE employees
          ADD COLUMN countsForAttendanceBonus TINYINT NOT NULL DEFAULT 1
      `);
    } catch {
      // ya existe
    }
  }

  private async assertShiftAssignments(
    shopId: string,
    raw?: Array<{ shiftId?: string | null; type?: string | null }> | null,
  ): Promise<EmployeeShiftAssignment[]> {
    const assignments = normalizeShiftAssignments(raw);
    if (!assignments.length) return [];
    const shop = await this.shops.getShopEntity(shopId);
    if (!shop) throw new NotFoundException('Local no encontrado');
    const validIds = new Set(
      normalizeShopShifts(shop.shifts, shop.openingTime).map((s) => s.id),
    );
    for (const a of assignments) {
      if (!validIds.has(a.shiftId)) {
        throw new BadRequestException('Turno inválido para este local');
      }
    }
    return assignments;
  }

  private toDto(e: Employee) {
    const shiftAssignments = normalizeShiftAssignments(e.shiftAssignments);
    return {
      id: e.id,
      shopId: e.shopId,
      fullName: e.fullName,
      baseSalary: n(e.baseSalary),
      userId: e.userId ?? null,
      hireDate: e.hireDate ?? null,
      notes: e.notes ?? null,
      type: deriveEmployeeType(shiftAssignments, e.type),
      shiftAssignments,
      countsForAttendanceBonus:
        e.countsForAttendanceBonus === undefined || e.countsForAttendanceBonus === null
          ? true
          : !!e.countsForAttendanceBonus,
      producesFood: !!e.producesFood,
      supervisorEmployeeId: e.supervisorEmployeeId ?? null,
      bankAlias: e.bankAlias?.trim() || null,
      overtimeHourRate: n(e.overtimeHourRate),
      holidayPayMultiplier:
        e.holidayPayMultiplier == null || e.holidayPayMultiplier === ''
          ? null
          : n(e.holidayPayMultiplier),
      serviceCheckIn: e.serviceCheckIn ?? null,
      serviceCheckOut: e.serviceCheckOut ?? null,
      active: isEntityActive(e.active),
    };
  }

  async list(user: AuthUser, shopId: string, includeInactive = false) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    const filtered = includeInactive
      ? rows
      : rows.filter((r) => isEntityActive(r.active));
    return filtered.map((r) => this.toDto(r));
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.employees.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Empleado no encontrado');
    return this.toDto(row);
  }

  private async assertUserLink(shopId: string, userId: string | null | undefined, excludeId?: string) {
    if (!userId) return;
    const link = await this.userShops.findOne({ where: { shopId, userId } });
    if (!link) {
      throw new BadRequestException('El usuario no pertenece a este local');
    }
    const clash = await this.employees.findOne({
      where: {
        shopId,
        userId,
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
    });
    if (clash) {
      throw new BadRequestException('Ese usuario ya está vinculado a otro empleado');
    }
    const u = await this.users.findOne({ where: { id: userId, active: true } });
    if (!u) throw new BadRequestException('Usuario no encontrado');
  }

  private async assertSupervisor(
    shopId: string,
    employeeId: string | undefined,
    supervisorEmployeeId: string | null | undefined,
    producesFood: boolean,
  ) {
    if (supervisorEmployeeId === undefined) return;
    if (!supervisorEmployeeId) return;
    if (!producesFood) {
      throw new BadRequestException(
        'Solo los productores (produce comida) pueden tener un supervisor a cargo',
      );
    }
    if (employeeId && supervisorEmployeeId === employeeId) {
      throw new BadRequestException('Un productor no puede ser su propio supervisor');
    }
    const supervisor = await this.employees.findOne({
      where: { id: supervisorEmployeeId, shopId },
    });
    if (!supervisor || !isEntityActive(supervisor.active) || !supervisor.producesFood) {
      throw new BadRequestException(
        'El supervisor debe ser un productor activo del mismo local',
      );
    }
    if (employeeId && supervisor.supervisorEmployeeId === employeeId) {
      throw new BadRequestException(
        'No se puede crear un ciclo de supervisión entre estos productores',
      );
    }
  }

  async create(
    user: AuthUser,
    shopId: string,
    dto: {
      fullName: string;
      baseSalary?: number;
      userId?: string | null;
      hireDate?: string | null;
      notes?: string | null;
      type?: EmployeeType;
      shiftAssignments?: Array<{ shiftId: string; type?: EmployeeType | string }> | null;
      countsForAttendanceBonus?: boolean;
      producesFood?: boolean;
      supervisorEmployeeId?: string | null;
      bankAlias?: string | null;
      overtimeHourRate?: number;
      holidayPayMultiplier?: number | null;
      serviceCheckIn?: string | null;
      serviceCheckOut?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.assertUserLink(shopId, dto.userId);
    const producesFood = !!dto.producesFood;
    await this.assertSupervisor(shopId, undefined, dto.supervisorEmployeeId, producesFood);
    const shiftAssignments = await this.assertShiftAssignments(shopId, dto.shiftAssignments);
    const type = shiftAssignments.length
      ? deriveEmployeeType(shiftAssignments, dto.type)
      : normalizeEmployeeType(dto.type);
    let holidayPayMultiplier: string | null = null;
    if (dto.holidayPayMultiplier != null) {
      if (dto.holidayPayMultiplier <= 0) {
        throw new BadRequestException('El multiplicador de feriado debe ser mayor a 0');
      }
      holidayPayMultiplier = Number(dto.holidayPayMultiplier).toFixed(2);
    }
    const row = await this.employees.save(
      this.employees.create({
        shopId,
        fullName: dto.fullName.trim(),
        baseSalary: money(n(dto.baseSalary)),
        userId: dto.userId ?? null,
        hireDate: dto.hireDate ?? null,
        notes: dto.notes ?? null,
        type,
        shiftAssignments: shiftAssignments.length ? shiftAssignments : null,
        countsForAttendanceBonus:
          dto.countsForAttendanceBonus === undefined ? true : !!dto.countsForAttendanceBonus,
        producesFood,
        supervisorEmployeeId: producesFood ? (dto.supervisorEmployeeId ?? null) : null,
        bankAlias: dto.bankAlias?.trim() || null,
        overtimeHourRate: money(n(dto.overtimeHourRate)),
        holidayPayMultiplier,
        serviceCheckIn: parseHhMm(dto.serviceCheckIn),
        serviceCheckOut: parseHhMm(dto.serviceCheckOut),
        active: dto.active ?? true,
      }),
    );
    await this.salaries.recordHistory({
      shopId,
      employeeId: row.id,
      baseSalary: row.baseSalary,
      overtimeHourRate: row.overtimeHourRate,
      holidayPayMultiplier: row.holidayPayMultiplier ?? null,
      note: 'Alta de empleado',
      source: SalaryHistorySource.CREATE,
      createdByUserId: user.id,
    });
    this.live.tick(shopId, 'attendance');
    return this.toDto(row);
  }

  async update(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: {
      fullName?: string;
      baseSalary?: number;
      userId?: string | null;
      hireDate?: string | null;
      notes?: string | null;
      type?: EmployeeType;
      shiftAssignments?: Array<{ shiftId: string; type?: EmployeeType | string }> | null;
      countsForAttendanceBonus?: boolean;
      producesFood?: boolean;
      supervisorEmployeeId?: string | null;
      bankAlias?: string | null;
      overtimeHourRate?: number;
      holidayPayMultiplier?: number | null;
      serviceCheckIn?: string | null;
      serviceCheckOut?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (
      dto.baseSalary !== undefined ||
      dto.overtimeHourRate !== undefined ||
      dto.holidayPayMultiplier !== undefined
    ) {
      throw new BadRequestException(
        'El sueldo, la hora extra y el multiplicador de feriado se editan en el módulo Sueldos',
      );
    }
    const row = await this.employees.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Empleado no encontrado');
    if (dto.userId !== undefined) {
      await this.assertUserLink(shopId, dto.userId, id);
      row.userId = dto.userId;
    }
    if (dto.fullName !== undefined) row.fullName = dto.fullName.trim();
    if (dto.hireDate !== undefined) row.hireDate = dto.hireDate;
    if (dto.notes !== undefined) row.notes = dto.notes;
    if (dto.shiftAssignments !== undefined) {
      const shiftAssignments = await this.assertShiftAssignments(shopId, dto.shiftAssignments);
      row.shiftAssignments = shiftAssignments.length ? shiftAssignments : null;
      row.type = deriveEmployeeType(shiftAssignments, dto.type ?? row.type);
    } else if (dto.type !== undefined) {
      row.type = normalizeEmployeeType(dto.type);
    }
    if (dto.countsForAttendanceBonus !== undefined) {
      row.countsForAttendanceBonus = !!dto.countsForAttendanceBonus;
    }
    if (dto.producesFood !== undefined) row.producesFood = !!dto.producesFood;
    if (dto.bankAlias !== undefined) row.bankAlias = dto.bankAlias?.trim() || null;
    if (dto.serviceCheckIn !== undefined) row.serviceCheckIn = parseHhMm(dto.serviceCheckIn);
    if (dto.serviceCheckOut !== undefined) row.serviceCheckOut = parseHhMm(dto.serviceCheckOut);
    if (dto.active !== undefined) row.active = dto.active;

    const producesFood = !!row.producesFood;
    if (dto.supervisorEmployeeId !== undefined) {
      await this.assertSupervisor(shopId, id, dto.supervisorEmployeeId, producesFood);
      row.supervisorEmployeeId = producesFood ? dto.supervisorEmployeeId : null;
    } else if (dto.producesFood !== undefined && !producesFood) {
      row.supervisorEmployeeId = null;
    }

    await this.employees.save(row);
    this.live.tick(shopId, 'attendance');
    return this.toDto(row);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.employees.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Empleado no encontrado');
    row.active = false;
    await this.employees.save(row);
    this.live.tick(shopId, 'attendance');
    return { ok: true };
  }
}
