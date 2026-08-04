import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Employee, EmployeeType } from '../../entities/employee.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

function normalizeEmployeeType(value?: EmployeeType | string | null): EmployeeType {
  return value === EmployeeType.ROTATING ? EmployeeType.ROTATING : EmployeeType.FIXED;
}

@Injectable()
export class EmployeesService implements OnModuleInit {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
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
  }

  private toDto(e: Employee) {
    return {
      id: e.id,
      shopId: e.shopId,
      fullName: e.fullName,
      baseSalary: n(e.baseSalary),
      userId: e.userId ?? null,
      hireDate: e.hireDate ?? null,
      notes: e.notes ?? null,
      type: normalizeEmployeeType(e.type),
      producesFood: !!e.producesFood,
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
      producesFood?: boolean;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.assertUserLink(shopId, dto.userId);
    const row = await this.employees.save(
      this.employees.create({
        shopId,
        fullName: dto.fullName.trim(),
        baseSalary: money(n(dto.baseSalary)),
        userId: dto.userId ?? null,
        hireDate: dto.hireDate ?? null,
        notes: dto.notes ?? null,
        type: normalizeEmployeeType(dto.type),
        producesFood: !!dto.producesFood,
        active: dto.active ?? true,
      }),
    );
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
      producesFood?: boolean;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.employees.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Empleado no encontrado');
    if (dto.userId !== undefined) {
      await this.assertUserLink(shopId, dto.userId, id);
      row.userId = dto.userId;
    }
    if (dto.fullName !== undefined) row.fullName = dto.fullName.trim();
    if (dto.baseSalary !== undefined) row.baseSalary = money(n(dto.baseSalary));
    if (dto.hireDate !== undefined) row.hireDate = dto.hireDate;
    if (dto.notes !== undefined) row.notes = dto.notes;
    if (dto.type !== undefined) row.type = normalizeEmployeeType(dto.type);
    if (dto.producesFood !== undefined) row.producesFood = !!dto.producesFood;
    if (dto.active !== undefined) row.active = dto.active;
    await this.employees.save(row);
    return this.toDto(row);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.employees.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Empleado no encontrado');
    row.active = false;
    await this.employees.save(row);
    return { ok: true };
  }
}
