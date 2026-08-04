import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Employee } from '../../entities/employee.entity';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';

export interface ProductionAttendanceImportItem {
  rowNumber: number;
  employeeName: string;
  date: string;
  hours: number;
  employeeId: string | null;
  willCreateEmployee: boolean;
  willMarkProducer: boolean;
  valid: boolean;
  error?: string;
}

const n = (v?: string | number | null) => Number(v ?? 0);
const hoursStr = (v: number) => Math.max(0, Number(v) || 0).toFixed(2);

@Injectable()
export class ProductionAttendanceExcelImportService {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(ProductionAttendanceDay)
    private readonly days: Repository<ProductionAttendanceDay>,
    private readonly shops: ShopsService,
  ) {}

  async buildTemplate(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const wb = new ExcelJS.Workbook();

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 96;
    info.addRow(['Plantilla / importación de asistencia de producción']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([]);
    info.addRow([
      'Hoja "Produccion": Colaborador, Fecha, Horas. Solo productores (empleados con "Produce comida").',
    ]);
    info.addRow([
      'Al importar, si el colaborador no existe se crea como productor. Si existe sin producir comida, se marca como productor.',
    ]);

    const ws = wb.addWorksheet('Produccion');
    ws.columns = [
      { header: 'Colaborador', key: 'name', width: 22 },
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Horas', key: 'hours', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    const d = new Date();
    ws.addRow(['Kevin', this.toIsoDate(d), 8]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `plantilla-produccion-${shop.slug || 'local'}.xlsx`,
    };
  }

  async exportMonth(user: AuthUser, shopId: string, year: number, month: number) {
    this.shops.assertShopAccess(user, shopId);
    if (month < 1 || month > 12) {
      throw new BadRequestException('Mes inválido');
    }
    const shop = await this.shops.findOne(user, shopId);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;

    const employees = (
      await this.employees.find({ where: { shopId }, order: { fullName: 'ASC' } })
    ).filter((e) => isEntityActive(e.active) && !!e.producesFood);

    const rows = await this.days.find({
      where: { shopId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
    const byKey = new Map<string, ProductionAttendanceDay>();
    for (const r of rows) {
      byKey.set(`${r.employeeId}|${r.date}`, r);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 96;
    info.addRow(['Asistencia de producción exportada']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([`Período: ${String(month).padStart(2, '0')}/${year}`]);
    info.addRow([]);
    info.addRow(['Formato compatible con la importación: hoja "Produccion".']);

    const ws = wb.addWorksheet('Produccion');
    ws.columns = [
      { header: 'Colaborador', key: 'name', width: 22 },
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Horas', key: 'hours', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const emp of employees) {
      for (let day = 1; day <= last; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = byKey.get(`${emp.id}|${date}`);
        ws.addRow({
          name: emp.fullName,
          date,
          hours: n(cell?.hours),
        });
      }
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const monthPad = String(month).padStart(2, '0');
    const slug = this.fileSlug(shop.name || shop.slug || 'local');
    return {
      buffer,
      filename: `produccion-${slug}-${year}-${monthPad}.xlsx`,
    };
  }

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.parseWorkbook(file);
    return this.enrich(shopId, rows);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.parseWorkbook(file);
    const items = await this.enrich(shopId, rows);
    const valid = items.filter((i) => i.valid);
    if (!valid.length) {
      throw new BadRequestException('No hay filas válidas para importar');
    }

    const empCache = new Map<string, Employee>();
    const existing = await this.employees.find({ where: { shopId } });
    for (const e of existing) empCache.set(this.norm(e.fullName), e);

    const createdEmployees: string[] = [];
    const updatedEmployees: string[] = [];
    let upsertedDays = 0;

    const ensureEmployee = async (rawName: string): Promise<Employee> => {
      const key = this.norm(rawName);
      let emp = empCache.get(key);

      if (!emp) {
        emp = await this.employees.save(
          this.employees.create({
            shopId,
            fullName: rawName.trim(),
            baseSalary: '0',
            producesFood: true,
            active: true,
          }),
        );
        empCache.set(key, emp);
        createdEmployees.push(emp.fullName);
        return emp;
      }

      let changed = false;
      if (!emp.active) {
        emp.active = true;
        changed = true;
      }
      if (!emp.producesFood) {
        emp.producesFood = true;
        changed = true;
      }
      if (changed) {
        await this.employees.save(emp);
        updatedEmployees.push(emp.fullName);
      }
      return emp;
    };

    for (const item of valid) {
      const emp = await ensureEmployee(item.employeeName);
      let day = await this.days.findOne({
        where: { employeeId: emp.id, date: item.date },
      });
      if (!day) {
        day = this.days.create({
          shopId,
          employeeId: emp.id,
          date: item.date,
          hours: '0',
          active: true,
        });
      }
      day.hours = hoursStr(item.hours);
      day.active = true;
      await this.days.save(day);
      upsertedDays += 1;
    }

    return {
      upsertedDays,
      createdEmployees: [...new Set(createdEmployees)],
      updatedEmployees: [...new Set(updatedEmployees)],
      preview: items,
    };
  }

  private async enrich(
    shopId: string,
    rows: Array<{ rowNumber: number; employeeName: string; date: string; hours: number }>,
  ): Promise<ProductionAttendanceImportItem[]> {
    const employees = await this.employees.find({ where: { shopId } });
    const byName = new Map(employees.map((e) => [this.norm(e.fullName), e]));

    return rows.map((r) => {
      const emp = byName.get(this.norm(r.employeeName));
      const errors: string[] = [];
      if (!r.employeeName) errors.push('Falta colaborador');
      if (!r.date) errors.push('Fecha inválida');
      if (r.hours < 0) errors.push('Horas inválidas');
      const willCreate = !!r.employeeName && !emp;
      const willReactivate = !!emp && !emp.active;
      const willMarkProducer = !!emp && !emp.producesFood;
      return {
        ...r,
        employeeId: emp?.id ?? null,
        willCreateEmployee: willCreate || willReactivate,
        willMarkProducer,
        valid: errors.length === 0,
        error: errors.length ? errors.join('; ') : undefined,
      };
    });
  }

  private async parseWorkbook(file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Adjuntá un archivo Excel (.xlsx)');
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el Excel');
    }

    const baseSheet =
      wb.worksheets.find((s) => this.norm(s.name).includes('produccion')) ||
      wb.worksheets.find((s) => this.norm(s.name).includes('producción')) ||
      wb.worksheets.find((s) => !this.norm(s.name).includes('instruccion')) ||
      wb.worksheets[0];

    if (!baseSheet) throw new BadRequestException('El Excel no tiene hojas');

    const headerRow = baseSheet.getRow(1);
    const colMap = this.mapHeaders(headerRow);
    if (!colMap.employee || !colMap.date) {
      throw new BadRequestException(
        'Faltan columnas "Colaborador" y/o "Fecha" (hoja Produccion).',
      );
    }

    const rows: Array<{
      rowNumber: number;
      employeeName: string;
      date: string;
      hours: number;
    }> = [];

    baseSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const employeeName = this.parseStr(this.cell(row, colMap.employee)) ?? '';
      const date = this.parseDate(this.cell(row, colMap.date));
      if (!employeeName || !date) return;
      const hours = this.parseNum(this.cell(row, colMap.hours));
      rows.push({ rowNumber, employeeName, date, hours });
    });

    if (!rows.length) {
      throw new BadRequestException('No se encontraron filas de producción válidas');
    }
    return rows;
  }

  private mapHeaders(headerRow: ExcelJS.Row): Record<string, number | undefined> {
    const map: Record<string, number | undefined> = {};
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = this.norm(String(cell.value ?? ''));
      if (!key) return;
      if (key.includes('colaborador') || key.includes('empleado') || key === 'nombre') {
        map.employee = col;
      } else if (key === 'fecha' || key === 'date') map.date = col;
      else if (key.includes('hora')) map.hours = col;
    });
    return map;
  }

  private cell(row: ExcelJS.Row, col?: number): ExcelJS.CellValue | null {
    if (!col) return null;
    return row.getCell(col).value ?? null;
  }

  private parseDate(value: ExcelJS.CellValue | null): string | null {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return this.toIsoDate(value);
    }
    if (typeof value === 'number') {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + value * 86400000);
      return this.toIsoDate(d);
    }
    if (typeof value === 'object' && value && 'result' in (value as any)) {
      return this.parseDate((value as any).result);
    }
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dmy) {
      const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
      return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    return null;
  }

  private parseNum(value: ExcelJS.CellValue | null): number {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value && 'result' in (value as any)) {
      return this.parseNum((value as any).result);
    }
    const s = String(value).replace(/[^\d.,\-]/g, '').replace(',', '.');
    const num = Number(s);
    return Number.isFinite(num) ? num : 0;
  }

  private parseStr(value: ExcelJS.CellValue | null): string | null {
    if (value == null || value === '') return null;
    if (typeof value === 'object' && value && 'result' in (value as any)) {
      return this.parseStr((value as any).result);
    }
    if (typeof value === 'object' && value && 'text' in (value as any)) {
      return String((value as any).text).trim() || null;
    }
    const s = String(value).trim();
    return s || null;
  }

  private toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private fileSlug(name: string): string {
    return (
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'local'
    );
  }

  private norm(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
