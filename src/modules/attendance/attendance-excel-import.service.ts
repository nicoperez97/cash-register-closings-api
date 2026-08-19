import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Employee } from '../../entities/employee.entity';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import { AttendanceService } from './attendance.service';
import {
  computeOvertimeHours,
  DEFAULT_SERVICE_CHECK_IN,
  DEFAULT_SERVICE_CHECK_OUT,
  parseHhMm,
  requireHhMm,
} from '../../common/shift-hours.util';

export interface AttendanceImportItem {
  rowNumber: number;
  employeeName: string;
  date: string;
  isPresent: boolean;
  isHoliday: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  overtimeHours: number;
  employeeId: string | null;
  willCreateEmployee: boolean;
  baseSalaryHint: number | null;
  valid: boolean;
  error?: string;
}

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class AttendanceExcelImportService {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(AttendanceDay)
    private readonly days: Repository<AttendanceDay>,
    private readonly shops: ShopsService,
    private readonly attendance: AttendanceService,
  ) {}

  async buildTemplate(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const wb = new ExcelJS.Workbook();

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 96;
    info.addRow(['Plantilla / importación de presentismo']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([]);
    info.addRow([
      'Compatible con el Excel "Presentismo": hoja "Base de datos" (Colaborador, Fecha, Presente, Feriado, Entrada, Salida)',
    ]);
    info.addRow([
      'y opcionalmente "Validación de datos" (Colaborador, Sueldo actual) para crear/actualizar empleados.',
    ]);

    const ws = wb.addWorksheet('Base de datos');
    ws.columns = [
      { header: 'Colaborador', key: 'name', width: 18 },
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Feriado', key: 'holiday', width: 10 },
      { header: 'Presente', key: 'present', width: 10 },
      { header: 'Entrada', key: 'checkIn', width: 10 },
      { header: 'Salida', key: 'checkOut', width: 10 },
      { header: 'Horas extras', key: 'ot', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    const d = new Date();
    ws.addRow(['Kevin', this.toIsoDate(d), false, true, '18:00', '00:00', 0]);

    const val = wb.addWorksheet('Validación de datos');
    val.columns = [
      { header: 'Colaborador', width: 18 },
      { header: 'Sueldo actual', width: 14 },
    ];
    val.getRow(1).font = { bold: true };
    val.addRow(['Kevin', 550000]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `plantilla-presentismo-${shop.slug || 'local'}.xlsx`,
    };
  }

  /** Exporta el presentismo del mes en el mismo formato que la plantilla de importación. */
  async exportMonth(user: AuthUser, shopId: string, year: number, month: number) {
    this.shops.assertShopAccess(user, shopId);
    if (month < 1 || month > 12) {
      throw new BadRequestException('Mes inválido');
    }
    const shop = await this.shops.findOne(user, shopId);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;

    const employees = await this.employees.find({
      where: { shopId },
      order: { fullName: 'ASC' },
    });
    const rows = await this.days.find({
      where: {
        shopId,
        date: Between(from, to),
      },
      order: { date: 'ASC' },
    });
    const byKey = new Map<string, AttendanceDay>();
    for (const r of rows) {
      byKey.set(`${r.employeeId}|${r.date}`, r);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 96;
    info.addRow(['Presentismo exportado']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([`Período: ${String(month).padStart(2, '0')}/${year}`]);
    info.addRow([]);
    info.addRow([
      'Formato compatible con la importación: hoja "Base de datos" y "Validación de datos".',
    ]);

    const ws = wb.addWorksheet('Base de datos');
    ws.columns = [
      { header: 'Colaborador', key: 'name', width: 22 },
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Feriado', key: 'holiday', width: 10 },
      { header: 'Presente', key: 'present', width: 10 },
      { header: 'Entrada', key: 'checkIn', width: 10 },
      { header: 'Salida', key: 'checkOut', width: 10 },
      { header: 'Horas extras', key: 'ot', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };

    const activeEmployees = employees.filter((e) => isEntityActive(e.active));

    for (const emp of activeEmployees) {
      for (let day = 1; day <= last; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = byKey.get(`${emp.id}|${date}`);
        ws.addRow({
          name: emp.fullName,
          date,
          holiday: !!cell?.isHoliday,
          present: !!cell?.isPresent,
          checkIn: cell?.checkInAt ?? '',
          checkOut: cell?.checkOutAt ?? '',
          ot: n(cell?.overtimeHours),
        });
      }
    }

    const val = wb.addWorksheet('Validación de datos');
    val.columns = [
      { header: 'Colaborador', width: 22 },
      { header: 'Sueldo actual', width: 14 },
    ];
    val.getRow(1).font = { bold: true };
    for (const emp of activeEmployees) {
      val.addRow([emp.fullName, n(emp.baseSalary)]);
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const monthPad = String(month).padStart(2, '0');
    const slug = this.fileSlug(shop.name || shop.slug || 'local');
    return {
      buffer,
      filename: `presentismo-${slug}-${year}-${monthPad}.xlsx`,
    };
  }

  async exportOvertimeSummary(user: AuthUser, shopId: string, from: string, to: string) {
    const data = await this.attendance.overtimeSummary(user, shopId, from, to);
    const shop = await this.shops.findOne(user, shopId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Horas extra');
    ws.columns = [
      { header: 'Empleado', key: 'name', width: 28 },
      { header: 'Días presente', key: 'present', width: 14 },
      { header: 'Horas extra', key: 'hours', width: 14 },
      { header: 'Precio x hora', key: 'rate', width: 16 },
      { header: 'Costo extra', key: 'cost', width: 16 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const row of data.items) {
      ws.addRow({
        name: row.fullName,
        present: row.presentDays,
        hours: row.overtimeHours,
        rate: row.overtimeHourRate,
        cost: row.overtimeCost,
      });
    }
    ws.addRow({
      name: 'Total',
      present: data.totals.presentDays,
      hours: data.totals.overtimeHours,
      rate: '',
      cost: data.totals.overtimeCost,
    });
    ws.getRow(ws.rowCount).font = { bold: true };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = this.fileSlug(shop.name || shop.slug || 'local');
    return {
      buffer,
      filename: `horas-extra-${slug}-${from}_${to}.xlsx`,
    };
  }

  private fileSlug(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'local';
  }

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const { rows, salaries } = await this.parseWorkbook(shopId, file);
    return this.enrich(shopId, rows, salaries);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const { rows, salaries } = await this.parseWorkbook(shopId, file);
    const items = await this.enrich(shopId, rows, salaries);
    const valid = items.filter((i) => i.valid);
    if (!valid.length && salaries.size === 0) {
      throw new BadRequestException('No hay filas válidas para importar');
    }

    const empCache = new Map<string, Employee>();
    const existing = await this.employees.find({ where: { shopId } });
    for (const e of existing) empCache.set(this.norm(e.fullName), e);

    const createdEmployees: string[] = [];
    const updatedEmployees: string[] = [];
    let upsertedDays = 0;

    const ensureEmployee = async (
      rawName: string,
      salaryHint?: number | null,
    ): Promise<Employee> => {
      const key = this.norm(rawName);
      let emp = empCache.get(key);
      const salary = salaryHint ?? salaries.get(key) ?? null;

      if (!emp) {
        emp = await this.employees.save(
          this.employees.create({
            shopId,
            fullName: rawName.trim(),
            baseSalary: money(salary ?? 0),
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
      if (salary != null && salary > 0 && n(emp.baseSalary) !== salary) {
        emp.baseSalary = money(salary);
        changed = true;
      }
      if (changed) {
        await this.employees.save(emp);
        updatedEmployees.push(emp.fullName);
      }
      return emp;
    };

    // 1) Empleados de Validación de datos (aunque no tengan filas de asistencia)
    for (const [nameKey, salary] of salaries) {
      const display =
        valid.find((i) => this.norm(i.employeeName) === nameKey)?.employeeName ??
        this.displayName(nameKey, valid) ??
        nameKey;
      await ensureEmployee(display, salary);
    }

    // 2) Empleados que aparecen solo en Base de datos
    const uniqueNames = [...new Set(valid.map((i) => i.employeeName.trim()).filter(Boolean))];
    for (const name of uniqueNames) {
      await ensureEmployee(name, salaries.get(this.norm(name)));
    }

    // 3) Días de presentismo
    for (const item of valid) {
      const emp = await ensureEmployee(item.employeeName, salaries.get(this.norm(item.employeeName)));

      let day = await this.days.findOne({
        where: { employeeId: emp.id, date: item.date },
      });
      if (!day) {
        day = this.days.create({
          shopId,
          employeeId: emp.id,
          date: item.date,
          isPresent: false,
          isHoliday: false,
          overtimeHours: '0',
          active: true,
        });
      }
      day.isPresent = item.isPresent;
      day.isHoliday = item.isHoliday;
      day.checkInAt = item.isPresent ? item.checkInAt : null;
      day.checkOutAt = item.isPresent ? item.checkOutAt : null;
      day.overtimeHours = String(item.overtimeHours);
      day.active = true;
      await this.days.save(day);
      upsertedDays += 1;
    }

    if (!createdEmployees.length && !updatedEmployees.length && !upsertedDays) {
      throw new BadRequestException('No hay filas válidas para importar');
    }

    return {
      upsertedDays,
      createdEmployees: [...new Set(createdEmployees)],
      updatedEmployees: [...new Set(updatedEmployees)],
      preview: items,
    };
  }

  private displayName(normName: string, items: AttendanceImportItem[]): string {
    const hit = items.find((i) => this.norm(i.employeeName) === normName);
    return hit?.employeeName ?? normName;
  }

  private async enrich(
    shopId: string,
    rows: Array<{
      rowNumber: number;
      employeeName: string;
      date: string;
      isPresent: boolean;
      isHoliday: boolean;
      checkInAt: string | null;
      checkOutAt: string | null;
      overtimeHours: number;
    }>,
    salaries: Map<string, number | null>,
  ): Promise<AttendanceImportItem[]> {
    const employees = await this.employees.find({ where: { shopId } });
    const byName = new Map(employees.map((e) => [this.norm(e.fullName), e]));

    return rows.map((r) => {
      const emp = byName.get(this.norm(r.employeeName));
      const errors: string[] = [];
      if (!r.employeeName) errors.push('Falta colaborador');
      if (!r.date) errors.push('Fecha inválida');
      const willCreate = !!r.employeeName && !emp;
      const willReactivate = !!emp && !emp.active;
      return {
        ...r,
        employeeId: emp?.id ?? null,
        willCreateEmployee: willCreate || willReactivate,
        baseSalaryHint: salaries.get(this.norm(r.employeeName)) ?? null,
        valid: errors.length === 0,
        error: errors.length ? errors.join('; ') : undefined,
      };
    });
  }

  private async parseWorkbook(shopId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Adjuntá un archivo Excel (.xlsx)');
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el Excel');
    }

    const salaries = new Map<string, number | null>();
    const valSheet =
      wb.worksheets.find((s) => this.norm(s.name).includes('validacion')) ||
      wb.worksheets.find((s) => this.norm(s.name).includes('validación'));
    if (valSheet) {
      const header = valSheet.getRow(1);
      let nameCol = 1;
      let salaryCol = 2;
      header.eachCell({ includeEmpty: false }, (cell, col) => {
        const key = this.norm(String(cell.value ?? ''));
        if (key.includes('colaborador') || key.includes('empleado') || key === 'nombre') {
          nameCol = col;
        }
        if (key.includes('sueldo')) salaryCol = col;
      });
      valSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        const name = this.parseStr(row.getCell(nameCol).value);
        if (!name) return;
        const salary = this.parseNum(row.getCell(salaryCol).value);
        salaries.set(this.norm(name), salary > 0 ? salary : null);
      });
    }

    const baseSheet =
      wb.worksheets.find((s) => this.norm(s.name) === 'base de datos') ||
      wb.worksheets.find((s) => this.norm(s.name).includes('presentismo')) ||
      wb.worksheets.find((s) => this.norm(s.name).includes('asistencia')) ||
      wb.worksheets.find((s) => !this.norm(s.name).includes('instruccion')) ||
      wb.worksheets[0];

    if (!baseSheet) throw new BadRequestException('El Excel no tiene hojas');

    const headerRow = baseSheet.getRow(1);
    const colMap = this.mapHeaders(headerRow);
    if (!colMap.employee || !colMap.date) {
      throw new BadRequestException(
        'Faltan columnas "Colaborador" y/o "Fecha" (hoja Base de datos del Excel de Presentismo).',
      );
    }

    const rows: Array<{
      rowNumber: number;
      employeeName: string;
      date: string;
      isPresent: boolean;
      isHoliday: boolean;
      checkInAt: string | null;
      checkOutAt: string | null;
      overtimeHours: number;
    }> = [];

    const shop = await this.shops.getShopEntity(shopId);
    const defaultIn = requireHhMm(shop?.serviceDefaultCheckIn, DEFAULT_SERVICE_CHECK_IN);
    const defaultOut = requireHhMm(shop?.serviceDefaultCheckOut, DEFAULT_SERVICE_CHECK_OUT);

    baseSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const employeeName = this.parseStr(this.cell(row, colMap.employee)) ?? '';
      const date = this.parseDate(this.cell(row, colMap.date));
      if (!employeeName || !date) return;
      const isPresent = this.parseBool(this.cell(row, colMap.present));
      const isHoliday = this.parseBool(this.cell(row, colMap.holiday));
      const checkInAt = isPresent
        ? parseHhMm(this.parseStr(this.cell(row, colMap.checkIn))) ?? defaultIn
        : null;
      const checkOutAt = isPresent
        ? parseHhMm(this.parseStr(this.cell(row, colMap.checkOut))) ?? defaultOut
        : null;
      const overtimeHours = computeOvertimeHours({
        isPresent,
        checkInAt,
        checkOutAt,
        defaultCheckOut: defaultOut,
      });
      rows.push({
        rowNumber,
        employeeName,
        date,
        isPresent,
        isHoliday,
        checkInAt,
        checkOutAt,
        overtimeHours,
      });
      if (!salaries.has(this.norm(employeeName))) {
        salaries.set(this.norm(employeeName), null);
      }
    });

    if (!rows.length) {
      throw new BadRequestException('No se encontraron filas de presentismo válidas');
    }
    return { rows, salaries };
  }

  private mapHeaders(headerRow: ExcelJS.Row): Record<string, number | undefined> {
    const map: Record<string, number | undefined> = {};
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = this.norm(String(cell.value ?? ''));
      if (!key) return;
      if (key.includes('colaborador') || key.includes('empleado') || key === 'nombre') {
        map.employee = col;
      } else if (key === 'fecha' || key === 'date') map.date = col;
      else if (key.includes('feriado')) map.holiday = col;
      else if (key.includes('presente') || key === 'present') map.present = col;
      else if (key.includes('entrada') || key.includes('checkin') || key.includes('check-in')) {
        map.checkIn = col;
      } else if (
        key.includes('salida') ||
        key.includes('checkout') ||
        key.includes('check-out') ||
        key.includes('retirada')
      ) {
        map.checkOut = col;
      } else if (key.includes('hora extra') || key.includes('horas extra') || key === 'ot') {
        map.overtime = col;
      }
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

  private parseBool(value: ExcelJS.CellValue | null): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = this.norm(String(value ?? ''));
    return s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes' || s === 'x';
  }

  private toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
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
