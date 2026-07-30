import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { AuthUser } from '../../common/decorators';
import { EmployeeCommissionRule } from '../../entities/employee-commission-rule.entity';
import { Employee } from '../../entities/employee.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { ShopsService } from '../shops/shops.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => Number(v.toFixed(2));

function normCat(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export interface CreateCommissionRuleDto {
  employeeId: string;
  category: string;
  ratePercent: number;
  notes?: string | null;
  active?: boolean;
}

export interface UpdateCommissionRuleDto {
  category?: string;
  ratePercent?: number;
  notes?: string | null;
  active?: boolean;
}

@Injectable()
export class CommissionsService {
  constructor(
    @InjectRepository(EmployeeCommissionRule)
    private readonly rules: Repository<EmployeeCommissionRule>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(PosSaleTicketLine)
    private readonly lines: Repository<PosSaleTicketLine>,
    private readonly shops: ShopsService,
  ) {}

  async listRules(user: AuthUser, shopId: string, employeeId?: string | null) {
    this.shops.assertShopAccess(user, shopId);
    const qb = this.rules
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.employee', 'e')
      .where('r.shopId = :shopId', { shopId })
      .andWhere('r.active = 1')
      .orderBy('e.fullName', 'ASC')
      .addOrderBy('r.category', 'ASC');
    if (employeeId) qb.andWhere('r.employeeId = :employeeId', { employeeId });
    const rows = await qb.getMany();
    return rows.map((r) => this.toRuleDto(r));
  }

  async createRule(user: AuthUser, shopId: string, dto: CreateCommissionRuleDto) {
    this.shops.assertShopAccess(user, shopId);
    const employee = await this.employees.findOne({
      where: { id: dto.employeeId, shopId, active: true },
    });
    if (!employee) throw new BadRequestException('Empleado no encontrado');

    const category = dto.category?.trim();
    if (!category) throw new BadRequestException('Rubro obligatorio');
    if (dto.ratePercent == null || dto.ratePercent < 0) {
      throw new BadRequestException('Porcentaje inválido');
    }

    const existing = await this.rules.findOne({
      where: { shopId, employeeId: dto.employeeId, category },
    });
    if (existing?.active) {
      throw new BadRequestException('Ya existe una regla para ese empleado y rubro');
    }

    const row =
      existing ??
      this.rules.create({
        shopId,
        employeeId: dto.employeeId,
        category,
        ratePercent: '0',
        active: true,
      });
    row.category = category;
    row.ratePercent = Number(dto.ratePercent).toFixed(4);
    row.notes = dto.notes?.trim() || null;
    row.active = dto.active ?? true;
    row.deletedAt = undefined;
    const saved = await this.rules.save(row);
    saved.employee = employee;
    return this.toRuleDto(saved);
  }

  async updateRule(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: UpdateCommissionRuleDto,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.rules.findOne({
      where: { id, shopId },
      relations: ['employee'],
    });
    if (!row) throw new NotFoundException('Regla no encontrada');

    if (dto.category !== undefined) {
      const category = dto.category.trim();
      if (!category) throw new BadRequestException('Rubro obligatorio');
      const clash = await this.rules.findOne({
        where: { shopId, employeeId: row.employeeId, category },
      });
      if (clash && clash.id !== row.id && clash.active) {
        throw new BadRequestException('Ya existe una regla para ese empleado y rubro');
      }
      row.category = category;
    }
    if (dto.ratePercent !== undefined) {
      if (dto.ratePercent < 0) throw new BadRequestException('Porcentaje inválido');
      row.ratePercent = Number(dto.ratePercent).toFixed(4);
    }
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) row.active = dto.active;
    const saved = await this.rules.save(row);
    return this.toRuleDto(saved);
  }

  async removeRule(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.rules.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Regla no encontrada');
    row.active = false;
    await this.rules.save(row);
    return { ok: true };
  }

  async calculate(user: AuthUser, shopId: string, from: string, to: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!from || !to) throw new BadRequestException('from y to son obligatorios');

    const salesRaw = await this.lines
      .createQueryBuilder('l')
      .innerJoin('l.ticket', 't')
      .select("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')", 'category')
      .addSelect('SUM(l.amount)', 'amount')
      .addSelect('SUM(l.qty)', 'qty')
      .where('t.shopId = :shopId', { shopId })
      .andWhere('t.active = 1')
      .andWhere('l.active = 1')
      .andWhere('t.businessDate BETWEEN :from AND :to', { from, to })
      .groupBy("COALESCE(NULLIF(TRIM(l.category), ''), 'Sin rubro')")
      .orderBy('amount', 'DESC')
      .getRawMany();

    const salesByCategory = salesRaw.map((r) => ({
      category: String(r.category),
      amount: money(n(r.amount)),
      qty: n(r.qty),
    }));
    const salesMap = new Map(
      salesByCategory.map((s) => [normCat(s.category), s]),
    );
    const salesTotal = money(salesByCategory.reduce((a, s) => a + s.amount, 0));

    const rules = await this.rules.find({
      where: { shopId, active: true },
      relations: ['employee'],
      order: { category: 'ASC' },
    });

    const byEmployee = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        lines: Array<{
          ruleId: string;
          category: string;
          salesAmount: number;
          ratePercent: number;
          commissionAmount: number;
        }>;
        total: number;
      }
    >();

    for (const rule of rules) {
      if (!rule.employee?.active) continue;
      const key = rule.employeeId;
      let bucket = byEmployee.get(key);
      if (!bucket) {
        bucket = {
          employeeId: key,
          employeeName: rule.employee.fullName,
          lines: [],
          total: 0,
        };
        byEmployee.set(key, bucket);
      }
      const sales = salesMap.get(normCat(rule.category));
      const salesAmount = sales?.amount ?? 0;
      const ratePercent = n(rule.ratePercent);
      const commissionAmount = money((salesAmount * ratePercent) / 100);
      bucket.lines.push({
        ruleId: rule.id,
        category: rule.category,
        salesAmount,
        ratePercent,
        commissionAmount,
      });
      bucket.total = money(bucket.total + commissionAmount);
    }

    const employees = [...byEmployee.values()].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, 'es'),
    );
    const grandTotal = money(employees.reduce((a, e) => a + e.total, 0));

    return {
      shopId,
      from,
      to,
      salesTotal,
      salesByCategory,
      employees,
      grandTotal,
      unmatchedRules: rules
        .filter((r) => r.employee?.active && !salesMap.has(normCat(r.category)))
        .map((r) => ({
          employeeName: r.employee?.fullName ?? null,
          category: r.category,
          ratePercent: n(r.ratePercent),
        })),
    };
  }

  async exportExcel(user: AuthUser, shopId: string, from: string, to: string) {
    const data = await this.calculate(user, shopId, from, to);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';
    const moneyFmt = '$#,##0.00';

    const ws = wb.addWorksheet('Comisiones');
    ws.columns = [
      { header: 'Empleado', key: 'employee', width: 28 },
      { header: 'Rubro', key: 'category', width: 24 },
      { header: 'Ventas', key: 'sales', width: 14 },
      { header: '%', key: 'rate', width: 10 },
      { header: 'Comisión', key: 'commission', width: 14 },
    ];
    for (const emp of data.employees) {
      for (const line of emp.lines) {
        ws.addRow({
          employee: emp.employeeName,
          category: line.category,
          sales: line.salesAmount,
          rate: line.ratePercent,
          commission: line.commissionAmount,
        });
      }
      ws.addRow({
        employee: emp.employeeName,
        category: 'TOTAL',
        sales: null,
        rate: null,
        commission: emp.total,
      });
    }
    ws.addRow({});
    ws.addRow({
      employee: 'TOTAL GENERAL',
      category: '',
      sales: data.salesTotal,
      rate: null,
      commission: data.grandTotal,
    });
    ws.getColumn('sales').numFmt = moneyFmt;
    ws.getColumn('commission').numFmt = moneyFmt;

    const wsS = wb.addWorksheet('Ventas por rubro');
    wsS.columns = [
      { header: 'Rubro', key: 'category', width: 28 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Importe', key: 'amount', width: 14 },
    ];
    for (const s of data.salesByCategory) {
      wsS.addRow({ category: s.category, qty: s.qty, amount: s.amount });
    }
    wsS.getColumn('amount').numFmt = moneyFmt;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `comisiones-${from}_${to}.xlsx`,
    };
  }

  private toRuleDto(r: EmployeeCommissionRule) {
    return {
      id: r.id,
      shopId: r.shopId,
      employeeId: r.employeeId,
      employeeName: r.employee?.fullName ?? null,
      category: r.category,
      ratePercent: n(r.ratePercent),
      notes: r.notes ?? null,
      active: r.active,
    };
  }
}
