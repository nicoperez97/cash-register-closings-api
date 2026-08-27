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
import { GeminiDocumentService } from '../ai/gemini-document.service';
import { MovementFilters, MovementsService } from './movements.service';

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
  detectedKind: 'expense' | 'income' | 'transfer';
}

export type LedgerImportKind = 'expense' | 'income' | 'transfer';

export type LedgerImportGemini = {
  ok: boolean;
  summary: string | null;
  findings: string[];
  accounts: Array<{ name: string; note: string }>;
  warnings: string[];
  message: string | null;
};

export type LedgerImportPreview = {
  items: MovementImportItem[];
  gemini: LedgerImportGemini;
};

/** Cómo matchear una cuenta del Excel con una del local. */
export type AccountImportMapping = {
  excelName: string;
  /** Cuenta existente del local. Si falta y create es true, se crea. */
  accountId?: string | null;
  create?: boolean;
};

export type ConceptImportMapping = {
  excelName: string;
  conceptId?: string | null;
  create?: boolean;
};

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
    private readonly gemini: GeminiDocumentService,
    private readonly movementsService: MovementsService,
  ) {}

  async buildTemplate(
    user: AuthUser,
    shopId: string,
    _kind: LedgerImportKind = 'expense',
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';

    const info = wb.addWorksheet('Instrucciones');
    info.getColumn(1).width = 96;
    info.addRow(['Plantilla / importación del libro (gastos, ingresos y pases entre cuentas)']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([]);
    info.addRow([
      'Compatible con el Excel del contador: hoja "Movimientos" (Fecha, Cuenta Emisora, Cuenta Receptora, Importe $). No uses la hoja oculta de saldos acumulados.',
    ]);
    info.addRow([
      'Columnas clave: Fecha, Cuenta Emisora, Cuenta Receptora, Descripción, Importe $, Concepto validado.',
    ]);
    info.addRow([
      'Gasto: receptora 2. Egreso (o similar). Ejemplo: MP Toma → 2. Egreso, concepto Materia prima.',
    ]);
    info.addRow([
      'Ingreso: emisora 1. Ingreso (o similar). Ejemplo: 1. Ingreso → MP Toma, concepto EFECTIVO ingreso.',
    ]);
    info.addRow([
      'Pase entre cuentas: dos cuentas operativas (no Ingreso/Egreso). Ejemplo: MP Toma → Efectivo Caja.',
    ]);
    info.addRow(['Al importar vas a ver una vista previa y podés elegir qué módulos cargar.']);
    info.addRow(['Si la cuenta o el concepto no existen en el local, se crean al confirmar la importación.']);
    info.addRow([
      'Filas ya existentes (misma fecha, cuentas, monto y descripción) se omiten: podés subir el mismo Excel dos veces sin duplicar.',
    ]);
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
    const iso = this.toIsoDate(yesterday);
    ws.addRow([
      iso,
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
    ws.addRow([
      iso,
      '1. Ingreso',
      'MP Toma',
      'Ejemplo efectivo ingreso',
      8000,
      '',
      '',
      'EFECTIVO ingreso',
      false,
      '',
    ]);
    ws.addRow([
      iso,
      'MP Toma',
      'Efectivo Caja',
      'Ejemplo pase a efectivo',
      5000,
      '',
      '',
      'Transferencia e/ cuentas',
      false,
      '',
    ]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = shop.slug || 'local';
    return {
      buffer,
      filename: `plantilla-libro-diario-${slug}.xlsx`,
    };
  }

  /** Exporta movimientos del período en el mismo formato que la plantilla de importación. */
  async exportRange(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const rows = [...(await this.movementsService.list(user, shopId, filters))].reverse();

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
      const fromName = m.fromAccountName || m.fromUserName || '';
      const toName = m.toAccountName || m.toUserName || '';
      ws.addRow([
        m.businessDate,
        fromName,
        toName,
        m.description ?? '',
        n(m.amountUyu),
        m.usdRate != null ? n(m.usdRate) : '',
        m.amountUsd != null ? n(m.amountUsd) : '',
        m.conceptName ?? '',
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

  async preview(
    user: AuthUser,
    shopId: string,
    file: Express.Multer.File,
    kind?: LedgerImportKind,
  ): Promise<LedgerImportPreview> {
    this.shops.assertShopAccess(user, shopId);
    const drafts = await this.parseWorkbook(file);
    const items = await this.enrich(shopId, drafts, kind);
    const gemini = await this.analyzeWithGemini(items, file.originalname);
    return { items, gemini };
  }

  async commit(
    user: AuthUser,
    shopId: string,
    file: Express.Multer.File,
    kind?: LedgerImportKind,
    modules?: LedgerImportKind[],
    accountMap?: AccountImportMapping[],
    conceptMap?: ConceptImportMapping[],
  ) {
    this.shops.assertShopAccess(user, shopId);
    const items = await this.enrich(shopId, await this.parseWorkbook(file), kind);
    const selected = this.normalizeModules(kind, modules);
    const valid = items.filter(
      (i) => i.valid && !i.alreadyExists && (!selected || selected.includes(i.detectedKind)),
    );
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
    const accountById = new Map<string, LedgerAccount>();
    const conceptCache = new Map<string, Concept>();
    const accounts = await this.accounts.find({ where: { shopId }, withDeleted: true });
    for (const a of accounts) {
      accountCache.set(this.norm(a.name), a);
      accountById.set(a.id, a);
    }
    const mappingByExcel = this.indexAccountMap(accountMap);
    const conceptById = new Map<string, Concept>();
    const concepts = await this.concepts.find({ where: { shopId }, withDeleted: true });
    for (const c of concepts) {
      conceptCache.set(this.norm(c.name), c);
      conceptById.set(c.id, c);
    }
    const conceptMapping = this.indexConceptMap(conceptMap);

    const created: string[] = [];
    const createdAccounts: string[] = [];
    const createdConcepts: string[] = [];
    const skipList = skipped.map((i) => ({
      rowNumber: i.rowNumber,
      businessDate: i.businessDate,
      reason: 'Ya existe un movimiento igual',
    }));

    for (const item of valid) {
      const from = await this.resolveMappedAccount(
        shopId,
        item.fromAccountName,
        accountCache,
        accountById,
        mappingByExcel,
        createdAccounts,
      );
      const to = await this.resolveMappedAccount(
        shopId,
        item.toAccountName,
        accountCache,
        accountById,
        mappingByExcel,
        createdAccounts,
      );

      let conceptId: string | null = null;
      if (item.conceptName) {
        const concept = await this.resolveMappedConcept(
          shopId,
          item.conceptName,
          item.fromAccountName,
          item.toAccountName,
          conceptCache,
          conceptById,
          conceptMapping,
          createdConcepts,
        );
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
      | 'detectedKind'
    >>,
    kind?: LedgerImportKind,
  ): Promise<MovementImportItem[]> {
    const accounts = await this.accounts.find({ where: { shopId, active: true } });
    const concepts = await this.concepts.find({ where: { shopId, active: true } });
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
      const from = this.findAccount(d.fromAccountName, accounts);
      const to = this.findAccount(d.toAccountName, accounts);
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
      if (d.fromAccountName && d.toAccountName && this.norm(d.fromAccountName) === this.norm(d.toAccountName)) {
        errors.push('Emisora y receptora deben ser distintas');
      }

      const detectedKind = this.classifyLedgerRow(d.fromAccountName, d.toAccountName);

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
        detectedKind,
      };
    });
  }

  private isEgresoName(name: string): boolean {
    const v = this.norm(name);
    return v === 'egreso' || v.includes('egreso');
  }

  private isIngresoName(name: string): boolean {
    const v = this.norm(name);
    return v === 'ingreso' || v.includes('ingreso');
  }

  private classifyLedgerRow(fromName: string, toName: string): LedgerImportKind {
    if (this.isEgresoName(toName)) return 'expense';
    if (this.isIngresoName(fromName)) return 'income';
    return 'transfer';
  }

  private isSystemLedgerName(name: string): boolean {
    return this.isIngresoName(name) || this.isEgresoName(name);
  }

  private async analyzeWithGemini(
    items: MovementImportItem[],
    fileName?: string,
  ): Promise<LedgerImportGemini> {
    const empty: LedgerImportGemini = {
      ok: false,
      summary: null,
      findings: [],
      accounts: [],
      warnings: [],
      message: null,
    };
    if (!this.gemini.isEnabled()) return empty;
    try {
      const res = await this.gemini.analyzeLedgerImport(
        this.ledgerDigest(items, fileName),
      );
      if (!res.ok) {
        return { ...empty, message: res.message };
      }
      return {
        ok: true,
        summary: res.data.summary,
        findings: res.data.findings,
        accounts: res.data.accounts,
        warnings: res.data.warnings,
        message: null,
      };
    } catch {
      return { ...empty, message: 'No se pudo analizar el Excel con Gemini.' };
    }
  }

  private ledgerDigest(items: MovementImportItem[], fileName?: string) {
    const usable = items.filter((i) => i.valid && i.amountUyu > 0);
    const round = (v: number) => Math.round(v * 100) / 100;
    const accounts = new Map<
      string,
      { name: string; incoming: number; outgoing: number }
    >();
    const flows = new Map<
      string,
      { from: string; to: string; kind: string; count: number; sum: number }
    >();
    const bump = (name: string) => {
      const key = this.norm(name) || name;
      let row = accounts.get(key);
      if (!row) {
        row = { name, incoming: 0, outgoing: 0 };
        accounts.set(key, row);
      }
      return row;
    };
    let expenses = 0;
    let incomes = 0;
    let transfers = 0;
    let minDate = '';
    let maxDate = '';
    for (const i of usable) {
      const amt = n(i.amountUyu);
      bump(i.fromAccountName).outgoing += amt;
      bump(i.toAccountName).incoming += amt;
      const flowKey = `${this.norm(i.fromAccountName)}=>${this.norm(i.toAccountName)}`;
      const flow = flows.get(flowKey) ?? {
        from: i.fromAccountName,
        to: i.toAccountName,
        kind: i.detectedKind,
        count: 0,
        sum: 0,
      };
      flow.count += 1;
      flow.sum += amt;
      flows.set(flowKey, flow);
      if (i.detectedKind === 'expense') expenses += 1;
      else if (i.detectedKind === 'income') incomes += 1;
      else transfers += 1;
      if (i.businessDate && (!minDate || i.businessDate < minDate)) minDate = i.businessDate;
      if (i.businessDate && (!maxDate || i.businessDate > maxDate)) maxDate = i.businessDate;
    }
    const accountRows = [...accounts.values()]
      .filter((a) => !this.isSystemLedgerName(a.name))
      .map((a) => ({
        name: a.name,
        incoming: round(a.incoming),
        outgoing: round(a.outgoing),
        net: round(a.incoming - a.outgoing),
      }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 12);
    const topFlows = [...flows.values()]
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 12)
      .map((f) => ({
        from: f.from,
        to: f.to,
        kind: f.kind,
        count: f.count,
        sum: round(f.sum),
      }));
    return {
      fileName: fileName || null,
      rows: {
        total: items.length,
        valid: usable.length,
        expenses,
        incomes,
        transfers,
      },
      period: { from: minDate || null, to: maxDate || null },
      rule: 'Saldo de cada cuenta operativa = entra - sale. Ingreso y Egreso no son cajas.',
      accounts: accountRows,
      topFlows,
    };
  }

  private normalizeModules(
    kind?: LedgerImportKind,
    modules?: LedgerImportKind[],
  ): LedgerImportKind[] | undefined {
    const allowed: LedgerImportKind[] = ['expense', 'income', 'transfer'];
    const fromQuery = (modules ?? []).filter((m): m is LedgerImportKind =>
      allowed.includes(m),
    );
    if (fromQuery.length) return [...new Set(fromQuery)];
    if (kind && allowed.includes(kind)) return [kind];
    return undefined;
  }

  private indexAccountMap(mappings?: AccountImportMapping[]) {
    const map = new Map<string, AccountImportMapping>();
    for (const m of mappings ?? []) {
      const key = this.norm(m.excelName ?? '');
      if (!key) continue;
      map.set(key, m);
    }
    return map;
  }

  private async resolveMappedAccount(
    shopId: string,
    excelName: string,
    cacheByName: Map<string, LedgerAccount>,
    byId: Map<string, LedgerAccount>,
    mappingByExcel: Map<string, AccountImportMapping>,
    createdAccounts: string[],
  ): Promise<LedgerAccount> {
    const key = this.norm(excelName);
    const mapped = mappingByExcel.get(key);
    if (mapped?.accountId) {
      const existing = byId.get(mapped.accountId);
      if (existing) {
        cacheByName.set(key, existing);
        return existing;
      }
    }
    const cached = cacheByName.get(key);
    if (cached) return cached;

    if (!mapped?.create) {
      const unique = [
        ...new Map([...cacheByName.values()].map((a) => [a.id, a])).values(),
      ];
      const fuzzy = this.findAccount(excelName, unique);
      if (fuzzy) {
        cacheByName.set(key, fuzzy);
        return fuzzy;
      }
    }

    try {
      const created = await this.accounts.save(
        this.accounts.create({
          shopId,
          name: excelName.trim(),
          code: this.makeCode(excelName),
          type: this.guessAccountType(excelName),
          active: true,
        }),
      );
      cacheByName.set(key, created);
      cacheByName.set(this.norm(created.name), created);
      byId.set(created.id, created);
      createdAccounts.push(created.name);
      return created;
    } catch (err) {
      if (!this.isDuplicateError(err)) throw err;
      const existing = await this.accounts.findOne({
        where: { shopId, name: excelName.trim() },
        withDeleted: true,
      });
      if (!existing) throw err;
      cacheByName.set(key, existing);
      cacheByName.set(this.norm(existing.name), existing);
      byId.set(existing.id, existing);
      return existing;
    }
  }

  private indexConceptMap(mappings?: ConceptImportMapping[]) {
    const map = new Map<string, ConceptImportMapping>();
    for (const m of mappings ?? []) {
      const key = this.norm(m.excelName ?? '');
      if (!key) continue;
      map.set(key, m);
    }
    return map;
  }

  private async resolveMappedConcept(
    shopId: string,
    excelName: string,
    fromAccountName: string,
    toAccountName: string,
    cacheByName: Map<string, Concept>,
    byId: Map<string, Concept>,
    mappingByExcel: Map<string, ConceptImportMapping>,
    createdConcepts: string[],
  ): Promise<Concept> {
    const key = this.norm(excelName);
    const mapped = mappingByExcel.get(key);
    if (mapped?.conceptId) {
      const existing = byId.get(mapped.conceptId);
      if (existing) {
        cacheByName.set(key, existing);
        return existing;
      }
    }
    const cached = cacheByName.get(key);
    if (cached) return cached;

    try {
      const created = await this.concepts.save(
        this.concepts.create({
          shopId,
          name: excelName.trim(),
          kind: this.guessConceptKind(fromAccountName, toAccountName),
          active: true,
          validated: true,
        }),
      );
      cacheByName.set(key, created);
      cacheByName.set(this.norm(created.name), created);
      byId.set(created.id, created);
      createdConcepts.push(created.name);
      return created;
    } catch (err) {
      if (!this.isDuplicateError(err)) throw err;
      const existing =
        (await this.concepts.findOne({
          where: { shopId, name: excelName.trim() },
          withDeleted: true,
        })) ??
        (await this.findConceptByNormalizedName(shopId, key));
      if (!existing) throw err;
      cacheByName.set(key, existing);
      cacheByName.set(this.norm(existing.name), existing);
      byId.set(existing.id, existing);
      return existing;
    }
  }

  private async findConceptByNormalizedName(shopId: string, key: string) {
    const rows = await this.concepts.find({ where: { shopId }, withDeleted: true });
    return rows.find((c) => this.norm(c.name) === key) ?? null;
  }

  private isDuplicateError(err: unknown): boolean {
    const any = err as {
      code?: string | number;
      errno?: number;
      driverError?: { code?: string; errno?: number };
    };
    return (
      any?.code === 'ER_DUP_ENTRY' ||
      any?.errno === 1062 ||
      any?.driverError?.code === 'ER_DUP_ENTRY' ||
      any?.driverError?.errno === 1062
    );
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

    const ws = this.pickLedgerSheet(wb);

    if (!ws) {
      throw new BadRequestException(
        'El Excel no tiene una hoja de movimientos con Fecha, Cuenta Emisora y Cuenta Receptora.',
      );
    }

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

  private pickLedgerSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
    const skip = (s: ExcelJS.Worksheet) => {
      const n = this.norm(s.name);
      return (
        n.includes('saldo') ||
        n.includes('inversion') ||
        n.includes('cotizacion') ||
        n.includes('instruccion')
      );
    };
    const hasLedgerHeaders = (s: ExcelJS.Worksheet) => {
      const map = this.mapHeaders(s.getRow(1));
      return !!(map.businessDate && map.fromAccount && map.toAccount);
    };
    const preferred = ['movimientos', 'original completa movimientos'];
    for (const name of preferred) {
      const ws = wb.worksheets.find((s) => this.norm(s.name) === this.norm(name));
      if (ws && hasLedgerHeaders(ws)) return ws;
    }
    const visible = wb.worksheets.find(
      (s) => (s.state === 'visible' || !s.state) && !skip(s) && hasLedgerHeaders(s),
    );
    if (visible) return visible;
    return wb.worksheets.find((s) => !skip(s) && hasLedgerHeaders(s));
  }

  private findAccount(
    name: string,
    accounts: LedgerAccount[],
  ): LedgerAccount | undefined {
    const key = this.norm(name);
    if (!key) return undefined;
    const exact = accounts.find((a) => this.norm(a.name) === key);
    if (exact) return exact;

    const stripped = this.norm(name.replace(/\btoma\b/gi, ' '));
    if (stripped && stripped !== key) {
      const bySuffix = accounts.find((a) => this.norm(a.name) === stripped);
      if (bySuffix) return bySuffix;
    }

    if (this.isIngresoName(name)) {
      const sys = accounts.find(
        (a) => a.type === LedgerAccountType.SYSTEM && this.isIngresoName(a.name),
      );
      if (sys) return sys;
    }
    if (this.isEgresoName(name)) {
      const sys = accounts.find(
        (a) => a.type === LedgerAccountType.SYSTEM && this.isEgresoName(a.name),
      );
      if (sys) return sys;
    }

    const hits = accounts.filter((a) => {
      const nk = this.norm(a.name);
      if (nk.length < 2) return false;
      return key.startsWith(`${nk} `) || nk.startsWith(`${key} `);
    });
    if (!hits.length) return undefined;
    hits.sort((a, b) => this.norm(b.name).length - this.norm(a.name).length);
    return hits[0];
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
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'object' && value && 'result' in (value as any)) {
      return this.parseNum((value as any).result);
    }
    const raw = String(value).trim();
    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');
    let normalized = raw;
    if (hasComma && hasDot) {
      normalized = raw.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      normalized = raw.replace(',', '.');
    }
    const s = normalized.replace(/[^\d.\-]/g, '');
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
