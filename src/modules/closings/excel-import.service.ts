import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import * as ExcelJS from 'exceljs';
import { CashClosing } from '../../entities/cash-closing.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { ClosingsService } from './closings.service';

export interface ExcelImportItem {
  businessDate: string;
  posSystemAmount: number;
  cardAmount: number;
  cashAmount: number;
  mercadoPagoAmount: number;
  deliveryAppsAmount: number;
  transferAmount: number;
  accountDniAmount: number;
  otherAmount: number;
  declaredTotal: number;
  cashLeftInRegister: number;
  cashWithdrawn: number;
  cashWithdrawnByName: string | null;
  cashWithdrawnByUserId: string | null;
  unitsSold: number | null;
  coversCount: number | null;
  tipsAmount: number;
  notes: string | null;
  alreadyExists: boolean;
  willCreateUser?: boolean;
  rowNumber: number;
}

type DraftRow = Omit<
  ExcelImportItem,
  'alreadyExists' | 'willCreateUser' | 'cashWithdrawnByUserId'
> & { cashWithdrawnByUserId?: string | null };

const TEMPLATE_HEADERS = [
  'Fecha',
  'Caja',
  'PVS',
  'Efectivo',
  'MP',
  'Delivery',
  'Transferencia',
  'Cuenta DNI',
  'Otro',
  'Total',
  'Cambio en caja',
  'Retiro',
  'Quién se lo lleva',
  'Unidades',
  'Comensales',
  'Propinas',
  'Notas',
] as const;

@Injectable()
export class ExcelImportService {
  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly closingsService: ClosingsService,
  ) {}

  async buildTemplate(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cierres de caja';

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 88;
    info.addRow(['Plantilla de importación de cierres']);
    info.getRow(1).font = { bold: true, size: 14 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([]);
    info.addRow(['1. Completá la hoja "Cierres" (una fila por día).']);
    info.addRow(['2. La Fecha es obligatoria (AAAA-MM-DD o DD/MM/AAAA).']);
    info.addRow(['3. Completá al menos PVS o Efectivo (u otros medios).']);
    info.addRow(['4. Si Total queda vacío, se calcula sumando los medios.']);
    info.addRow(['5. "Quién se lo lleva": nombre de un usuario del local (si no existe, se crea como Visor con contraseña aleatoria; no se puede usar hasta reset).']);
    info.addRow(['6. No cambies los nombres de las columnas de la fila 1.']);
    info.addRow(['7. Borrá la fila de ejemplo antes de importar, o dejala si querés cargar ese día.']);

    const ws = wb.addWorksheet('Cierres');
    ws.columns = TEMPLATE_HEADERS.map((header) => ({
      header,
      width: header === 'Notas' || header === 'Quién se lo lleva' ? 22 : 14,
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8F5E9' },
    };

    const exampleDate = new Date();
    exampleDate.setDate(exampleDate.getDate() - 1);
    ws.addRow([
      this.toIsoDate(exampleDate),
      15000,
      8000,
      5000,
      1000,
      0,
      0,
      0,
      0,
      14000,
      2000,
      3000,
      '',
      40,
      '',
      0,
      'Ejemplo — borrá o editá esta fila',
    ]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `plantilla-cierres-${shop.slug}.xlsx`,
    };
  }

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const drafts = await this.parseWorkbook(file);
    return this.enrich(shopId, drafts, false);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const drafts = await this.parseWorkbook(file);
    const items = await this.enrich(shopId, drafts, true);

    const created: string[] = [];
    const createdUsers: string[] = [];
    const skipped: Array<{ businessDate: string; reason: string }> = [];

    for (const item of items) {
      if (item.alreadyExists) {
        skipped.push({
          businessDate: item.businessDate,
          reason: 'Ya existe un cierre para esa fecha',
        });
        continue;
      }
      if (!this.hasAmounts(item)) {
        skipped.push({
          businessDate: item.businessDate,
          reason: 'Sin montos suficientes',
        });
        continue;
      }
      try {
        if (item.willCreateUser && item.cashWithdrawnByName) {
          createdUsers.push(item.cashWithdrawnByName);
        }
        const row = await this.closingsService.create(user, shopId, {
          businessDate: item.businessDate,
          posSystemAmount: item.posSystemAmount || undefined,
          cardAmount: item.cardAmount || undefined,
          cashAmount: item.cashAmount || undefined,
          mercadoPagoAmount: item.mercadoPagoAmount || undefined,
          deliveryAppsAmount: item.deliveryAppsAmount || undefined,
          transferAmount: item.transferAmount || undefined,
          accountDniAmount: item.accountDniAmount || undefined,
          otherAmount: item.otherAmount || undefined,
          cashLeftInRegister: item.cashLeftInRegister || undefined,
          cashWithdrawn: item.cashWithdrawn || undefined,
          cashWithdrawnByName: item.cashWithdrawnByName ?? undefined,
          cashWithdrawnByUserId: item.cashWithdrawnByUserId ?? undefined,
          unitsSold: item.unitsSold ?? undefined,
          coversCount: item.coversCount ?? undefined,
          tipsAmount: item.tipsAmount || undefined,
          declaredTotal: item.declaredTotal || undefined,
          notes: item.notes
            ? `${item.notes}\n[Importado desde Excel]`
            : '[Importado desde Excel]',
        });
        created.push(row.id);
      } catch (err: any) {
        skipped.push({
          businessDate: item.businessDate,
          reason: err?.message ?? 'Error al crear',
        });
      }
    }

    return {
      createdCount: created.length,
      skippedCount: skipped.length,
      createdIds: created,
      createdUsers: [...new Set(createdUsers)],
      skipped,
      preview: items,
    };
  }

  private async parseWorkbook(file: Express.Multer.File): Promise<DraftRow[]> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Adjuntá un archivo Excel (.xlsx)');
    }
    const name = (file.originalname || '').toLowerCase();
    const okMime =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream';
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !okMime) {
      throw new BadRequestException('El archivo debe ser Excel (.xlsx)');
    }

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el Excel');
    }

    const ws =
      wb.getWorksheet('Cierres') ||
      wb.worksheets.find((s) => this.norm(s.name) === 'cierres') ||
      wb.worksheets.find((s) => s.name !== 'Instrucciones') ||
      wb.worksheets[0];

    if (!ws) {
      throw new BadRequestException('El Excel no tiene hojas');
    }

    const headerRow = ws.getRow(1);
    const colMap = this.mapHeaders(headerRow);
    if (!colMap.businessDate) {
      throw new BadRequestException(
        'Falta la columna "Fecha" en la primera fila de la hoja Cierres',
      );
    }

    const drafts: DraftRow[] = [];
    const seenDates = new Set<string>();

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const businessDate = this.parseDate(this.cell(row, colMap.businessDate!));
      if (!businessDate) return;

      const cardAmount = this.parseNum(this.cell(row, colMap.cardAmount));
      const cashAmount = this.parseNum(this.cell(row, colMap.cashAmount));
      const mercadoPagoAmount = this.parseNum(this.cell(row, colMap.mercadoPagoAmount));
      const deliveryAppsAmount = this.parseNum(this.cell(row, colMap.deliveryAppsAmount));
      const transferAmount = this.parseNum(this.cell(row, colMap.transferAmount));
      const accountDniAmount = this.parseNum(this.cell(row, colMap.accountDniAmount));
      const otherAmount = this.parseNum(this.cell(row, colMap.otherAmount));
      const sum =
        cardAmount +
        cashAmount +
        mercadoPagoAmount +
        deliveryAppsAmount +
        transferAmount +
        accountDniAmount +
        otherAmount;
      const declaredRaw = this.parseNum(this.cell(row, colMap.declaredTotal));
      const declaredTotal = declaredRaw > 0 ? declaredRaw : sum;
      const posRaw = this.parseNum(this.cell(row, colMap.posSystemAmount));
      const who = this.parseStr(this.cell(row, colMap.cashWithdrawnByName));
      const notes = this.parseStr(this.cell(row, colMap.notes));

      if (seenDates.has(businessDate)) {
        return;
      }
      seenDates.add(businessDate);

      drafts.push({
        businessDate,
        posSystemAmount: posRaw > 0 ? posRaw : declaredTotal,
        cardAmount,
        cashAmount,
        mercadoPagoAmount,
        deliveryAppsAmount,
        transferAmount,
        accountDniAmount,
        otherAmount,
        declaredTotal,
        cashLeftInRegister: this.parseNum(this.cell(row, colMap.cashLeftInRegister)),
        cashWithdrawn: this.parseNum(this.cell(row, colMap.cashWithdrawn)),
        cashWithdrawnByName: who,
        unitsSold: this.parseOptInt(this.cell(row, colMap.unitsSold)),
        coversCount: this.parseOptInt(this.cell(row, colMap.coversCount)),
        tipsAmount: this.parseNum(this.cell(row, colMap.tipsAmount)),
        notes,
        rowNumber,
      });
    });

    if (!drafts.length) {
      throw new BadRequestException(
        'No se encontraron filas válidas (revisá Fecha y montos en la hoja Cierres)',
      );
    }
    return drafts;
  }

  private async enrich(
    shopId: string,
    drafts: DraftRow[],
    createMissingUsers: boolean,
  ): Promise<ExcelImportItem[]> {
    const dates = drafts.map((d) => d.businessDate);
    const existing = dates.length
      ? await this.closings.find({
          where: { shopId, businessDate: In(dates), active: true },
          select: ['businessDate'],
        })
      : [];
    const existingSet = new Set(existing.map((e) => e.businessDate));

    const allUsers = await this.users.find({ where: { active: true } });
    const links = await this.userShops.find({ where: { shopId } });
    const shopUserIds = new Set(links.map((l) => l.userId));
    const createdCache = new Map<string, User>();
    const seenInFile = new Set<string>();

    const items: ExcelImportItem[] = [];
    for (const d of drafts) {
      const name = d.cashWithdrawnByName?.trim() || null;
      let matched = name ? this.matchUser(name, allUsers) : null;
      let willCreateUser = false;

      if (name && !matched) {
        willCreateUser = true;
        if (createMissingUsers) {
          const key = this.normalizeName(name);
          matched = createdCache.get(key) ?? (await this.createViewerUser(name, shopId));
          createdCache.set(key, matched);
          allUsers.push(matched);
          shopUserIds.add(matched.id);
        }
      } else if (matched && !shopUserIds.has(matched.id) && createMissingUsers) {
        await this.linkUserToShop(matched.id, shopId);
        shopUserIds.add(matched.id);
      }

      const dupInFile = seenInFile.has(d.businessDate);
      seenInFile.add(d.businessDate);

      items.push({
        ...d,
        cashWithdrawnByName: matched?.fullName ?? name,
        cashWithdrawnByUserId: matched?.id ?? null,
        alreadyExists: existingSet.has(d.businessDate) || dupInFile,
        willCreateUser,
      });
    }
    return items;
  }

  private hasAmounts(item: ExcelImportItem): boolean {
    return (
      item.cardAmount > 0 ||
      item.cashAmount > 0 ||
      item.mercadoPagoAmount > 0 ||
      item.deliveryAppsAmount > 0 ||
      item.transferAmount > 0 ||
      item.accountDniAmount > 0 ||
      item.otherAmount > 0 ||
      item.declaredTotal > 0
    );
  }

  private mapHeaders(headerRow: ExcelJS.Row): Record<string, number | undefined> {
    const map: Record<string, number | undefined> = {};
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = this.headerKey(String(cell.value ?? ''));
      if (!key) return;
      if (['fecha', 'date', 'businessdate'].includes(key)) map.businessDate = col;
      else if (['caja', 'possistema', 'possistemamount', 'sistema'].includes(key))
        map.posSystemAmount = col;
      else if (['pvs', 'tarjeta', 'card', 'cardamount'].includes(key)) map.cardAmount = col;
      else if (['efectivo', 'cash', 'cashamount'].includes(key)) map.cashAmount = col;
      else if (['mp', 'mercadopago', 'mercado pago'].includes(key) || key.includes('mercadopago'))
        map.mercadoPagoAmount = col;
      else if (['delivery', 'apps', 'deliveryapps'].includes(key)) map.deliveryAppsAmount = col;
      else if (['transferencia', 'transfer', 'transferamount'].includes(key))
        map.transferAmount = col;
      else if (
        ['cuentadni', 'dni', 'cuenta dni', 'account dni', 'accountdni'].includes(key) ||
        key.includes('dni')
      )
        map.accountDniAmount = col;
      else if (['otro', 'other', 'otheramount'].includes(key)) map.otherAmount = col;
      else if (['total', 'declared', 'declaredtotal'].includes(key)) map.declaredTotal = col;
      else if (
        ['cambio', 'cambioencaja', 'cashleft', 'cashleftinregister'].includes(key) ||
        key.includes('cambio')
      )
        map.cashLeftInRegister = col;
      else if (['retiro', 'withdrawn', 'cashwithdrawn'].includes(key)) map.cashWithdrawn = col;
      else if (
        key.includes('quien') ||
        key.includes('lleva') ||
        ['who', 'retiropor'].includes(key)
      )
        map.cashWithdrawnByName = col;
      else if (['unidades', 'units', 'unitssold'].includes(key)) map.unitsSold = col;
      else if (['comensales', 'covers', 'coverscount'].includes(key)) map.coversCount = col;
      else if (['propinas', 'tips', 'tipsamount'].includes(key)) map.tipsAmount = col;
      else if (['notas', 'notes', 'nota', 'observaciones'].includes(key)) map.notes = col;
    });
    return map;
  }

  private headerKey(raw: string): string {
    return this.norm(raw).replace(/\s+/g, '');
  }

  private cell(row: ExcelJS.Row, col?: number): ExcelJS.CellValue | null {
    if (!col) return null;
    return row.getCell(col).value;
  }

  private parseDate(value: ExcelJS.CellValue | null): string | null {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return this.toIsoDate(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const epoch = Date.UTC(1899, 11, 30);
      const d = new Date(epoch + Math.round(value) * 86400000);
      return this.toIsoDate(d);
    }
    if (typeof value === 'object' && value && 'result' in (value as any)) {
      return this.parseDate((value as any).result);
    }
    if (typeof value === 'object' && value && 'text' in (value as any)) {
      return this.parseDate((value as any).text);
    }
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return null;
  }

  private parseNum(value: ExcelJS.CellValue | null): number {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value === 'object' && value && 'result' in (value as any)) {
      return this.parseNum((value as any).result);
    }
    let s = String(value).replace(/\$/g, '').replace(/\s/g, '').trim();
    if (!s) return 0;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d+,\d+$/.test(s)) {
      s = s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private parseOptInt(value: ExcelJS.CellValue | null): number | null {
    const n = this.parseNum(value);
    return n > 0 ? Math.round(n) : null;
  }

  private parseStr(value: ExcelJS.CellValue | null): string | null {
    if (value == null || value === '') return null;
    if (typeof value === 'object' && value && 'text' in (value as any)) {
      return this.parseStr((value as any).text);
    }
    const s = String(value).trim();
    return s || null;
  }

  private toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private async createViewerUser(fullName: string, shopId: string): Promise<User> {
    const passwordHash = await bcrypt.hash(randomBytes(24).toString('base64url'), 10);
    const email = await this.uniqueImportEmail(fullName);
    const user = await this.users.save(
      this.users.create({
        fullName: fullName.trim(),
        email,
        passwordHash,
        globalRole: GlobalRole.VIEWER,
        active: true,
      }),
    );
    await this.linkUserToShop(user.id, shopId);
    return user;
  }

  private async linkUserToShop(userId: string, shopId: string): Promise<void> {
    const existing = await this.userShops.findOne({ where: { userId, shopId } });
    if (existing) return;
    await this.userShops.save(
      this.userShops.create({
        userId,
        shopId,
        shopRole: GlobalRole.VIEWER,
      }),
    );
  }

  private async uniqueImportEmail(fullName: string): Promise<string> {
    const base =
      this.normalizeName(fullName)
        .replace(/\s+/g, '.')
        .replace(/[^a-z0-9.]/g, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '') || 'usuario';
    let email = `${base}@import.cierres.local`;
    let i = 1;
    while (await this.users.findOne({ where: { email } })) {
      email = `${base}.${i}@import.cierres.local`;
      i += 1;
    }
    return email;
  }

  private matchUser(name: string | null, users: User[]): User | null {
    if (!name || !users.length) return null;
    const norm = this.normalizeName(name);
    if (!norm) return null;
    const exact = users.find((u) => this.normalizeName(u.fullName) === norm);
    if (exact) return exact;
    const first = norm.split(/\s+/)[0];
    const partial = users.find((u) => {
      const n = this.normalizeName(u.fullName);
      return n.includes(norm) || (first.length >= 3 && n.includes(first));
    });
    return partial ?? null;
  }

  private normalizeName(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  }

  private norm(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
