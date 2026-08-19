import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { AuthUser } from '../../common/decorators';
import { ConceptKind } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { ConceptsService } from './concepts.service';
import { inferConceptCategories, normalizeConceptCategories } from '../../common/concept-categories';

export interface ConceptImportItem {
  rowNumber: number;
  name: string;
  description: string | null;
  kind: ConceptKind;
  categories: string[];
  validated: boolean;
  exists: boolean;
  valid: boolean;
  error?: string;
}

@Injectable()
export class ConceptsExcelService {
  constructor(
    private readonly shops: ShopsService,
    private readonly concepts: ConceptsService,
  ) {}

  async buildTemplate(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const wb = new ExcelJS.Workbook();

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 110;
    info.addRow(['Plantilla de conceptos']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([]);
    info.addRow(['Completá la hoja "Conceptos" (una fila por concepto) y subila en Administración → Conceptos.']);
    info.addRow(['Columnas:']);
    info.addRow(['· Nombre — obligatorio, único por local']);
    info.addRow(['· Descripción — opcional']);
    info.addRow(['· Tipo — Ingreso, Egreso o Transferencia (si falta, se usa Egreso)']);
    info.addRow([
      '· Categorías — una o más, separadas por coma: Empleados, Servicios, Proveedores, Movimientos, Otros',
    ]);
    info.addRow(['· Validado — Sí / No. Solo los validados aparecen al cargar movimientos y pagos.']);
    info.addRow([]);
    info.addRow(['Si el nombre ya existe, se actualiza descripción, tipo, categorías y validado.']);

    const ws = wb.addWorksheet('Conceptos');
    ws.columns = [
      { header: 'Nombre', key: 'name', width: 28 },
      { header: 'Descripción', key: 'description', width: 44 },
      { header: 'Tipo', key: 'kind', width: 16 },
      { header: 'Categorías', key: 'categories', width: 36 },
      { header: 'Validado', key: 'validated', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow(['Verdulería', 'Compra de frutas y verduras', 'Egreso', 'Proveedores, Movimientos', 'Sí']);
    ws.addRow(['Alquiler', 'Alquiler del local', 'Egreso', 'Servicios, Movimientos', 'No']);
    ws.addRow(['Sueldos', 'Haberes del mes', 'Egreso', 'Empleados, Movimientos', 'Sí']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `plantilla-conceptos-${shop.slug || 'local'}.xlsx`,
    };
  }

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File) {
    return this.parse(user, shopId, file);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
    const items = await this.parse(user, shopId, file);
    const existing = await this.concepts.findByShop(shopId);
    const byName = new Map(existing.map((c) => [this.norm(c.name), c]));
    const valid = items.filter((i) => i.valid);
    let createdCount = 0;
    let updatedCount = 0;
    for (const item of valid) {
      const prev = byName.get(this.norm(item.name));
      if (prev) {
        await this.concepts.update(user, shopId, prev.id, {
          description: item.description,
          kind: item.kind,
          categories: item.categories,
          validated: item.validated,
          active: true,
        });
        updatedCount += 1;
      } else {
        const created = await this.concepts.create(user, shopId, {
          name: item.name,
          description: item.description,
          kind: item.kind,
          categories: item.categories,
          validated: item.validated,
          active: true,
        });
        byName.set(this.norm(created.name), {
          id: created.id,
          shopId: created.shopId,
          name: created.name,
        } as any);
        createdCount += 1;
      }
    }
    return {
      createdCount,
      updatedCount,
      skippedCount: items.length - valid.length,
      items,
    };
  }

  private async parse(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    this.assertExcel(file);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el Excel');
    }
    const ws =
      wb.getWorksheet('Conceptos') ||
      wb.worksheets.find((s) => /concepto/i.test(s.name)) ||
      wb.worksheets[0];
    if (!ws) throw new BadRequestException('El Excel no tiene hojas');

    const header = (ws.getRow(1).values as unknown[])
      .slice(1)
      .map((v) => this.cellStr(v).toLowerCase());
    const col = (aliases: string[]) => {
      const i = header.findIndex((h) => aliases.some((a) => h.includes(a)));
      return i >= 0 ? i + 1 : -1;
    };
    const nameCol = col(['nombre', 'name', 'concepto']);
    const descCol = col(['descrip', 'description', 'detalle']);
    const kindCol = col(['tipo', 'kind']);
    const catCol = col(['categor', 'category', 'categories']);
    const valCol = col(['validado', 'validated']);
    if (nameCol < 0) {
      throw new BadRequestException('Falta la columna Nombre');
    }

    const existing = await this.concepts.findByShop(shopId);
    const byName = new Map(existing.map((c) => [this.norm(c.name), c]));
    const seen = new Set<string>();
    const items: ConceptImportItem[] = [];

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = this.cellStr(row.getCell(nameCol).value);
      const description = descCol > 0 ? this.cellStr(row.getCell(descCol).value) : '';
      const kindRaw = kindCol > 0 ? this.cellStr(row.getCell(kindCol).value) : '';
      const catRaw = catCol > 0 ? this.cellStr(row.getCell(catCol).value) : '';
      const valRaw = valCol > 0 ? this.cellStr(row.getCell(valCol).value) : '';
      if (!name && !description && !kindRaw && !catRaw && !valRaw) return;

      const kind = this.parseKind(kindRaw);
      const categories = catRaw
        ? normalizeConceptCategories(this.parseCategories(catRaw), inferConceptCategories(name))
        : inferConceptCategories(name);
      const key = this.norm(name);
      let error: string | undefined;
      if (!name) error = 'Falta el nombre';
      else if (!kind) error = 'Tipo inválido (Ingreso, Egreso o Transferencia)';
      else if (seen.has(key)) error = 'Nombre repetido en el Excel';
      if (key) seen.add(key);

      items.push({
        rowNumber,
        name,
        description: description || null,
        kind: kind ?? ConceptKind.EXPENSE,
        categories,
        validated: this.parseYes(valRaw),
        exists: !!byName.get(key),
        valid: !error,
        error,
      });
    });

    if (!items.length) {
      throw new BadRequestException('El Excel no tiene filas de conceptos');
    }
    return items;
  }

  private assertExcel(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Adjuntá un archivo Excel (.xlsx)');
    const name = (file.originalname || '').toLowerCase();
    const okMime =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream';
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !okMime) {
      throw new BadRequestException('El archivo debe ser Excel (.xlsx)');
    }
  }

  private parseCategories(raw: string): string[] {
    return raw
      .split(/[,;/|]+/)
      .map((p) => this.categoryFromLabel(p.trim()))
      .filter((v): v is string => !!v);
  }

  private categoryFromLabel(raw: string): string | null {
    const s = this.norm(raw);
    if (!s) return null;
    if (/emplead/.test(s) || s === 'employees') return 'EMPLOYEES';
    if (/servic/.test(s)) return 'SERVICES';
    if (/proveedor|supplier/.test(s)) return 'SUPPLIERS';
    if (/movimient|movement/.test(s)) return 'MOVEMENTS';
    if (/otro|other/.test(s)) return 'OTHERS';
    const upper = raw.trim().toUpperCase();
    if (['EMPLOYEES', 'SERVICES', 'SUPPLIERS', 'MOVEMENTS', 'OTHERS'].includes(upper)) {
      return upper;
    }
    return null;
  }

  private parseKind(raw: string): ConceptKind | null {
    const s = this.norm(raw);
    if (!s) return ConceptKind.EXPENSE;
    if (/^(ingreso|income|i)$/.test(s) || s.includes('ingreso')) return ConceptKind.INCOME;
    if (
      /^(egreso|expense|gasto|e)$/.test(s) ||
      s.includes('egreso') ||
      s.includes('gasto')
    ) {
      return ConceptKind.EXPENSE;
    }
    if (/^(transferencia|transfer|t)$/.test(s) || s.includes('transfer')) {
      return ConceptKind.TRANSFER;
    }
    return null;
  }

  private parseYes(raw: string): boolean {
    const s = this.norm(raw);
    if (!s) return false;
    return /^(si|s|yes|y|1|true|validado)$/.test(s);
  }

  private cellStr(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'object' && v && 'text' in (v as any)) return String((v as any).text ?? '').trim();
    if (typeof v === 'object' && v && 'result' in (v as any)) {
      return String((v as any).result ?? '').trim();
    }
    return String(v).trim();
  }

  private norm(v: string) {
    return (v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
