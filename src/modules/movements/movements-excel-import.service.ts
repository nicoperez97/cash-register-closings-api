import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { AuthUser } from '../../common/decorators';
import { ConceptKind, LedgerAccountType } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';

export interface MovementImportItem {
  rowNumber: number;
  businessDate: string;
  fromAccountName: string;
  toAccountName: string;
  description: string | null;
  amountUyu: number;
  usdRate: number | null;
  amountUsd: number | null;
  conceptName: string | null;
  invoiced: boolean;
  invoiceNumber: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  conceptId: string | null;
  willCreateFromAccount: boolean;
  willCreateToAccount: boolean;
  willCreateConcept: boolean;
  alreadyExists: boolean;
  valid: boolean;
  error?: string;
}

const TEMPLATE_HEADERS = [
  'Fecha',
  'Cuenta Emisora',
  'Cuenta Receptora',
  'Descripción del gasto',
  'Importe $',
  'Cotización dólar vendedor',
  'Importe USD',
  'Concepto validado',
  'Facturado',
  'Factura N°',
] as const;

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class MovementsExcelImportService {
  constructor(
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async buildTemplate(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 96;
    info.addRow(['Plantilla / importación de movimientos (libro de egresos e ingresos)']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([]);
    info.addRow([
      'Compatible con el Excel del contador: hojas "Movimientos", "Movimientos (saldos)" u "ORIGINAL COMPLETA Movimientos".',
    ]);
    info.addRow(['Columnas clave: Fecha, Cuenta Emisora, Cuenta Receptora, Descripción, Importe $, Concepto validado.']);
    info.addRow(['Si la cuenta o el concepto no existen en el local, se crean al confirmar la importación.']);
    info.addRow(['Filas ya existentes (misma fecha, cuentas, monto y descripción) se omiten.']);
    info.addRow(['No cambies los nombres de las columnas de la fila 1 en la hoja Movimientos.']);

    const ws = wb.addWorksheet('Movimientos');
    ws.columns = TEMPLATE_HEADERS.map((header) => ({
      header,
      width: header.includes('Descrip') || header.includes('Concepto') ? 28 : 16,
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE3F2FD' },
    };
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    ws.addRow([
      this.toIsoDate(yesterday),
      'MP Toma',
      '2. Egreso',
      'Ejemplo materia prima',
      10000,
      '',
      '',
      'Materia prima',
      false,
      '',
    ]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `plantilla-movimientos-${shop.slug || 'local'}.xlsx`,
    };
  }

  /** Exporta movimientos del período en el mismo formato que la plantilla de importación. */
  async exportRange(
    user: AuthUser,
    shopId: string,
    filters: { from?: string; to?: string; kind?: 'expense' | 'transfer' } = {},
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);

    const qb = this.movements
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.fromAccount', 'fromAccount')
      .leftJoinAndSelect('m.toAccount', 'toAccount')
      .leftJoinAndSelect('m.fromUser', 'fromUser')
      .leftJoinAndSelect('m.toUser', 'toUser')
      .leftJoinAndSelect('m.concept', 'concept')
      .where('m.shopId = :shopId', { shopId })
      .andWhere('m.active = true');

    if (filters.from) qb.andWhere('m.businessDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('m.businessDate <= :to', { to: filters.to });
    if (filters.kind === 'expense') {
      qb.andWhere(
        `(concept.kind = :expenseKind OR LOWER(toAccount.name) LIKE :egresoName OR UPPER(toAccount.code) = :egresoCode)`,
        { expenseKind: 'EXPENSE', egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
    } else if (filters.kind === 'transfer') {
      qb.andWhere(
        `(concept.kind IS NULL OR concept.kind <> :expenseKind) AND (toAccount.id IS NULL OR (LOWER(toAccount.name) NOT LIKE :egresoName AND UPPER(COALESCE(toAccount.code, '')) <> :egresoCode))`,
        { expenseKind: 'EXPENSE', egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
    }
    qb.orderBy('m.businessDate', 'ASC').addOrderBy('m.createdAt', 'ASC');
    const rows = await qb.getMany();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 96;
    info.addRow(['Movimientos exportados']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    if (filters.from || filters.to) {
      info.addRow([`Período: ${filters.from ?? '…'} → ${filters.to ?? '…'}`]);
    }
    info.addRow([]);
    info.addRow(['Formato compatible con la importación: hoja "Movimientos".']);

    const ws = wb.addWorksheet('Movimientos');
    ws.columns = TEMPLATE_HEADERS.map((header) => ({
      header,
      width: header.includes('Descrip') || header.includes('Concepto') ? 28 : 16,
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE3F2FD' },
    };

    for (const m of rows) {
      const fromName = m.fromAccount?.name || m.fromUser?.fullName || '';
      const toName = m.toAccount?.name || m.toUser?.fullName || '';
      ws.addRow([
        m.businessDate,
        fromName,
        toName,
        m.description ?? '',
        n(m.amountUyu),
        m.usdRate != null ? n(m.usdRate) : '',
        m.amountUsd != null ? n(m.amountUsd) : '',
        m.concept?.name ?? '',
        !!m.invoiced,
        m.invoiceNumber ?? '',
      ]);
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = this.fileSlug(shop.name || shop.slug || 'local');
    const fromPart = filters.from ?? 'inicio';
    const toPart = filters.to ?? 'hoy';
    return {
      buffer,
      filename: `movimientos-${slug}-${fromPart}_${toPart}.xlsx`,
    };
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

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const drafts = await this.parseWorkbook(file);
    return this.enrich(shopId, drafts);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const items = await this.enrich(shopId, await this.parseWorkbook(file));
    const valid = items.filter((i) => i.valid && !i.alreadyExists);
    const skipped = items.filter((i) => i.alreadyExists);
    if (!valid.length) {
      if (skipped.length) {
        return {
          createdCount: 0,
          skippedCount: skipped.length,
          createdIds: [] as string[],
          createdAccounts: [] as string[],
          createdConcepts: [] as string[],
          skipped: skipped.map((i) => ({
            rowNumber: i.rowNumber,
            businessDate: i.businessDate,
            reason: 'Ya existe un movimiento igual',
          })),
          preview: items,
        };
      }
      throw new BadRequestException('No hay filas válidas para importar');
    }

    const accountCache = new Map<string, LedgerAccount>();
    const conceptCache = new Map<string, Concept>();
    const accounts = await this.accounts.find({ where: { shopId } });
    for (const a of accounts) accountCache.set(this.norm(a.name), a);
    const concepts = await this.concepts.find({ where: { shopId } });
    for (const c of concepts) conceptCache.set(this.norm(c.name), c);

    const created: string[] = [];
    const createdAccounts: string[] = [];
    const createdConcepts: string[] = [];
    const skipList = skipped.map((i) => ({
      rowNumber: i.rowNumber,
      businessDate: i.businessDate,
      reason: 'Ya existe un movimiento igual',
    }));

    for (const item of valid) {
      let from = accountCache.get(this.norm(item.fromAccountName));
      if (!from) {
        from = await this.accounts.save(
          this.accounts.create({
            shopId,
            name: item.fromAccountName,
            code: this.makeCode(item.fromAccountName),
            type: this.guessAccountType(item.fromAccountName),
            active: true,
          }),
        );
        accountCache.set(this.norm(from.name), from);
        createdAccounts.push(from.name);
      }

      let to = accountCache.get(this.norm(item.toAccountName));
      if (!to) {
        to = await this.accounts.save(
          this.accounts.create({
            shopId,
            name: item.toAccountName,
            code: this.makeCode(item.toAccountName),
            type: this.guessAccountType(item.toAccountName),
            active: true,
          }),
        );
        accountCache.set(this.norm(to.name), to);
        createdAccounts.push(to.name);
      }

      let conceptId: string | null = null;
      if (item.conceptName) {
        let concept = conceptCache.get(this.norm(item.conceptName));
        if (!concept) {
          concept = await this.concepts.save(
            this.concepts.create({
              shopId,
              name: item.conceptName,
              kind: this.guessConceptKind(item.fromAccountName, item.toAccountName),
              active: true,
              validated: true,
            }),
          );
          conceptCache.set(this.norm(concept.name), concept);
          createdConcepts.push(concept.name);
        }
        conceptId = concept.id;
      }

      const row = await this.movements.save(
        this.movements.create({
          shopId,
          businessDate: item.businessDate,
          fromAccountId: from.id,
          toAccountId: to.id,
          description: item.description,
          amountUyu: money(item.amountUyu),
          usdRate: item.usdRate != null ? String(item.usdRate) : null,
          amountUsd: item.amountUsd != null ? String(item.amountUsd) : null,
          conceptId,
          invoiced: item.invoiced,
          invoiceNumber: item.invoiceNumber,
          closingId: null,
          employeeId: null,
          active: true,
        }),
      );
      created.push(row.id);
    }

    return {
      createdCount: created.length,
      skippedCount: skipList.length,
      createdIds: created,
      createdAccounts: [...new Set(createdAccounts)],
      createdConcepts: [...new Set(createdConcepts)],
      skipped: skipList,
      preview: items,
    };
  }

  private movementFingerprint(input: {
    businessDate: string;
    fromAccountName: string;
    toAccountName: string;
    description: string | null;
    amountUyu: number;
    amountUsd: number | null;
    conceptName: string | null;
    invoiceNumber: string | null;
  }): string {
    return [
      input.businessDate,
      this.norm(input.fromAccountName),
      this.norm(input.toAccountName),
      (input.description || '').trim().toLowerCase(),
      money(n(input.amountUyu)),
      input.amountUsd != null ? money(n(input.amountUsd)) : '',
      this.norm(input.conceptName || ''),
      (input.invoiceNumber || '').trim().toLowerCase(),
    ].join('|');
  }

  private async enrich(
    shopId: string,
    drafts: Array<Omit<
      MovementImportItem,
      | 'fromAccountId'
      | 'toAccountId'
      | 'conceptId'
      | 'willCreateFromAccount'
      | 'willCreateToAccount'
      | 'willCreateConcept'
      | 'alreadyExists'
      | 'valid'
      | 'error'
    >>,
  ): Promise<MovementImportItem[]> {
    const accounts = await this.accounts.find({ where: { shopId, active: true } });
    const concepts = await this.concepts.find({ where: { shopId, active: true } });
    const byAccount = new Map(accounts.map((a) => [this.norm(a.name), a]));
    const byConcept = new Map(concepts.map((c) => [this.norm(c.name), c]));

    const dates = [...new Set(drafts.map((d) => d.businessDate).filter(Boolean))];
    const existingRows = dates.length
      ? await this.movements.find({
          where: { shopId, businessDate: In(dates), active: true },
          relations: ['fromAccount', 'toAccount', 'concept'],
        })
      : [];
    const existingFingerprints = new Set(
      existingRows.map((m) =>
        this.movementFingerprint({
          businessDate: m.businessDate,
          fromAccountName: m.fromAccount?.name ?? '',
          toAccountName: m.toAccount?.name ?? '',
          description: m.description ?? null,
          amountUyu: n(m.amountUyu),
          amountUsd: m.amountUsd != null ? n(m.amountUsd) : null,
          conceptName: m.concept?.name ?? null,
          invoiceNumber: m.invoiceNumber ?? null,
        }),
      ),
    );
    const seenInFile = new Set<string>();

    return drafts.map((d) => {
      const from = byAccount.get(this.norm(d.fromAccountName));
      const to = byAccount.get(this.norm(d.toAccountName));
      const concept = d.conceptName
        ? byConcept.get(this.norm(d.conceptName))
        : null;
      const errors: string[] = [];
      if (!d.businessDate) errors.push('Fecha inválida');
      if (!d.fromAccountName) errors.push('Falta cuenta emisora');
      if (!d.toAccountName) errors.push('Falta cuenta receptora');
      if (!(d.amountUyu > 0 || (d.amountUsd != null && d.amountUsd > 0))) {
        errors.push('Sin importe');
      }
      const fp = this.movementFingerprint(d);
      const alreadyExists = existingFingerprints.has(fp) || seenInFile.has(fp);
      if (d.businessDate && d.fromAccountName && d.toAccountName) {
        seenInFile.add(fp);
      }
      return {
        ...d,
        fromAccountId: from?.id ?? null,
        toAccountId: to?.id ?? null,
        conceptId: concept?.id ?? null,
        willCreateFromAccount: !!d.fromAccountName && !from,
        willCreateToAccount: !!d.toAccountName && !to,
        willCreateConcept: !!d.conceptName && !concept,
        alreadyExists,
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

    const preferred = [
      'movimientos',
      'movimientos (saldos)',
      'original completa movimientos',
    ];
    const ws =
      preferred
        .map((name) =>
          wb.worksheets.find((s) => this.norm(s.name) === this.norm(name)),
        )
        .find(Boolean) ||
      wb.worksheets.find((s) => this.norm(s.name).includes('movimiento')) ||
      wb.worksheets.find((s) => !this.norm(s.name).includes('instruccion')) ||
      wb.worksheets[0];

    if (!ws) throw new BadRequestException('El Excel no tiene hojas');

    const headerRow = ws.getRow(1);
    const colMap = this.mapHeaders(headerRow);
    if (!colMap.businessDate) {
      throw new BadRequestException(
        'Falta la columna "Fecha". Usá la plantilla o el Excel del contador (hoja Movimientos).',
      );
    }
    if (!colMap.fromAccount || !colMap.toAccount) {
      throw new BadRequestException(
        'Faltan columnas "Cuenta Emisora" y/o "Cuenta Receptora".',
      );
    }

    const drafts: Array<{
      rowNumber: number;
      businessDate: string;
      fromAccountName: string;
      toAccountName: string;
      description: string | null;
      amountUyu: number;
      usdRate: number | null;
      amountUsd: number | null;
      conceptName: string | null;
      invoiced: boolean;
      invoiceNumber: string | null;
    }> = [];

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const businessDate = this.parseDate(this.cell(row, colMap.businessDate));
      if (!businessDate) return;
      const fromAccountName = this.parseStr(this.cell(row, colMap.fromAccount)) ?? '';
      const toAccountName = this.parseStr(this.cell(row, colMap.toAccount)) ?? '';
      if (!fromAccountName && !toAccountName) return;

      let amountUyu = this.parseNum(this.cell(row, colMap.amountUyu));
      const usdRateRaw = this.parseNum(this.cell(row, colMap.usdRate));
      let amountUsd = this.parseNum(this.cell(row, colMap.amountUsd));
      const usdRate = usdRateRaw > 0 ? usdRateRaw : null;
      if (!(amountUyu > 0) && amountUsd > 0 && usdRate) {
        amountUyu = amountUsd * usdRate;
      }
      if (!(amountUsd > 0) && amountUyu > 0 && usdRate) {
        amountUsd = amountUyu / usdRate;
      }

      drafts.push({
        rowNumber,
        businessDate,
        fromAccountName,
        toAccountName,
        description: this.parseStr(this.cell(row, colMap.description)),
        amountUyu,
        usdRate,
        amountUsd: amountUsd > 0 ? amountUsd : null,
        conceptName: this.parseStr(this.cell(row, colMap.concept)),
        invoiced: this.parseBool(this.cell(row, colMap.invoiced)),
        invoiceNumber: this.parseStr(this.cell(row, colMap.invoiceNumber)),
      });
    });

    if (!drafts.length) {
      throw new BadRequestException(
        'No se encontraron filas válidas en la hoja de movimientos',
      );
    }
    return drafts;
  }

  private mapHeaders(headerRow: ExcelJS.Row): Record<string, number | undefined> {
    const map: Record<string, number | undefined> = {};
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = this.norm(String(cell.value ?? ''));
      if (!key) return;
      if (key === 'fecha' || key === 'date') map.businessDate = col;
      else if (key.includes('cuenta emisora') || key === 'emisora' || key === 'from')
        map.fromAccount = col;
      else if (key.includes('cuenta receptora') || key === 'receptora' || key === 'to')
        map.toAccount = col;
      else if (key.includes('descripcion') || key.includes('descripción'))
        map.description = col;
      else if (
        key.includes('importe $') ||
        key === 'importe' ||
        key === 'importe$' ||
        key === 'monto' ||
        key === 'amountuyu'
      )
        map.amountUyu = col;
      else if (key.includes('cotizacion') || key.includes('cotización') || key.includes('dolar'))
        map.usdRate = col;
      else if (key.includes('importe usd') || key === 'usd' || key === 'amountusd')
        map.amountUsd = col;
      else if (key.includes('concepto')) map.concept = col;
      else if (key.includes('facturado') || key === 'invoiced') map.invoiced = col;
      else if (key.includes('factura')) map.invoiceNumber = col;
    });
    return map;
  }

  private guessAccountType(name: string): LedgerAccountType {
    const nrm = this.norm(name);
    if (nrm.includes('ingreso') || nrm.includes('egreso')) return LedgerAccountType.SYSTEM;
    if (nrm.startsWith('mp') || nrm.startsWith('pvs') || nrm.includes('dni') || nrm.includes('efectivo')) {
      return LedgerAccountType.CHANNEL;
    }
    return LedgerAccountType.PARTNER;
  }

  private guessConceptKind(from: string, to: string): ConceptKind {
    const f = this.norm(from);
    const t = this.norm(to);
    if (t.includes('egreso') || f.includes('egreso')) return ConceptKind.EXPENSE;
    if (f.includes('ingreso') || t.includes('ingreso')) return ConceptKind.INCOME;
    return ConceptKind.TRANSFER;
  }

  private makeCode(name: string): string {
    const base = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
    return `${base || 'CTA'}_${Date.now().toString(36).slice(-4)}`.toUpperCase();
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
    const s = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
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
    const s = this.norm(String(value ?? ''));
    return s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes';
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
