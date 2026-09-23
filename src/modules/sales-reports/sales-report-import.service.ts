import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import {
  DEFAULT_RESTOSOFT_PAYMENT_MAP,
  DEFAULT_WEMENU_PAYMENT_MAP,
  RESTOSOFT_PARSER_KEY,
  WEMENU_PARSER_KEY,
  SalesSystemsSeedService,
} from '../../common/sales-systems-seed.service';
import { PosCategory } from '../../entities/pos-category.entity';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosSaleDaily } from '../../entities/pos-sale-daily.entity';
import { PosSaleImport } from '../../entities/pos-sale-import.entity';
import { PosSaleTicket } from '../../entities/pos-sale-ticket.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { SalesSystem } from '../../entities/sales-system.entity';
import { Shop } from '../../entities/shop.entity';
import { GeminiDocumentService } from '../ai/gemini-document.service';
import { ShopsService } from '../shops/shops.service';
import { SalesParserRegistry } from './parsers/parser-registry';
import { ParsedTicket } from './parsers/sales-system-parser';
import type { PosPaymentField } from './parsers/sales-system-parser';
import {
  SEED_CATEGORIES,
  allSeedProducts,
  guessByCodeRange,
  guessWineVarietyFromName,
  looksLikeWineWithoutVariety,
  normProductCode,
} from './pos-catalog.seed';
import { SalesProductsAnalyticsService } from './sales-products-analytics.service';

const money = (n: number) => Number(n ?? 0).toFixed(2);

function chunkArray<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeProductCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^\d+\.0+$/.test(trimmed)) return String(parseInt(trimmed, 10));
  return trimmed.replace(/\.0+$/, '');
}

type PaymentBreakdown = Record<
  'cashAmount' | 'cardAmount' | 'mercadoPagoAmount' | 'deliveryAppsAmount' | 'transferAmount' | 'accountDniAmount' | 'otherAmount',
  number
>;

const EMPTY_BREAKDOWN = (): PaymentBreakdown => ({
  cashAmount: 0,
  cardAmount: 0,
  mercadoPagoAmount: 0,
  deliveryAppsAmount: 0,
  transferAmount: 0,
  accountDniAmount: 0,
  otherAmount: 0,
});

const FIELD_TO_KEY: Record<PosPaymentField | string, keyof PaymentBreakdown> = {
  cash: 'cashAmount',
  card: 'cardAmount',
  mercadoPago: 'mercadoPagoAmount',
  delivery: 'deliveryAppsAmount',
  transfer: 'transferAmount',
  accountDni: 'accountDniAmount',
  other: 'otherAmount',
};

export type SalesReportProductSource = 'catalog' | 'seed' | 'gemini' | 'none';

export interface SalesReportProductPreview {
  productCode: string;
  productName: string | null;
  category: string | null;
  subcategory: string | null;
  source: SalesReportProductSource;
  qty: number;
  amount: number;
}

export interface SalesReportProductLabelOverride {
  productCode: string;
  productName?: string | null;
  category?: string | null;
  subcategory?: string | null;
}

export interface SalesReportDayPreview {
  businessDate: string;
  ticketCount: number;
  coversCount: number;
  totalAmount: number;
  cashAmount: number;
  cardAmount: number;
  mercadoPagoAmount: number;
  deliveryAppsAmount: number;
  transferAmount: number;
  accountDniAmount: number;
  otherAmount: number;
  unknownPaymentCodes: string[];
}

export interface SalesReportPreview {
  salesSystemCode: string;
  salesSystemName: string;
  fileName: string | null;
  shopLabel: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  ticketCount: number;
  dayCount: number;
  days: SalesReportDayPreview[];
  unknownPaymentCodes: string[];
  products: SalesReportProductPreview[];
  categoryOptions: string[];
  geminiWarning: string | null;
}

@Injectable()
export class SalesReportImportService {
  constructor(
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    @InjectRepository(SalesSystem) private readonly systems: Repository<SalesSystem>,
    @InjectRepository(PosSaleImport) private readonly imports: Repository<PosSaleImport>,
    @InjectRepository(PosSaleTicket) private readonly tickets: Repository<PosSaleTicket>,
    @InjectRepository(PosSaleTicketLine) private readonly lines: Repository<PosSaleTicketLine>,
    @InjectRepository(PosSaleDaily) private readonly dailies: Repository<PosSaleDaily>,
    @InjectRepository(PosProduct) private readonly products: Repository<PosProduct>,
    @InjectRepository(PosCategory) private readonly categories: Repository<PosCategory>,
    private readonly shops: ShopsService,
    private readonly parsers: SalesParserRegistry,
    private readonly seed: SalesSystemsSeedService,
    private readonly productsAnalytics: SalesProductsAnalyticsService,
    private readonly gemini: GeminiDocumentService,
  ) {}

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File): Promise<SalesReportPreview> {
    this.shops.assertShopAccess(user, shopId);
    const { system, shop, parsed, paymentMap } = await this.prepare(shopId, file);
    const base = this.buildPreview(shop, system, file, parsed.tickets, parsed, paymentMap);
    const productsPreview = await this.buildProductsPreview(shopId, parsed.tickets);
    return {
      ...base,
      products: productsPreview.products,
      categoryOptions: productsPreview.categoryOptions,
      geminiWarning: productsPreview.geminiWarning,
    };
  }

  async commit(
    user: AuthUser,
    shopId: string,
    file: Express.Multer.File,
    productLabels?: SalesReportProductLabelOverride[] | null,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const { system, shop, parsed, paymentMap } = await this.prepare(shopId, file);
    const preview = this.buildPreview(shop, system, file, parsed.tickets, parsed, paymentMap);

    const imp = await this.imports.save(
      this.imports.create({
        shopId,
        salesSystemId: system.id,
        fileName: file.originalname ?? null,
        periodFrom: parsed.periodFrom,
        periodTo: parsed.periodTo,
        ticketCount: parsed.tickets.length,
        importedByUserId: user.id,
        active: true,
      }),
    );

    // Último ticket gana si el archivo trae externalId repetido.
    const ticketsByExt = new Map<string, ParsedTicket>();
    for (const t of parsed.tickets) {
      ticketsByExt.set(t.externalId, t);
    }
    const uniqueTickets = [...ticketsByExt.values()];
    const allLineItems = uniqueTickets.flatMap((t) => t.lines);
    const labelsByCode = await this.productsAnalytics.upsertFromLines(
      shopId,
      allLineItems,
      productLabels,
    );

    const existingByExt = new Map<string, PosSaleTicket>();
    for (const ids of chunkArray([...ticketsByExt.keys()], 400)) {
      const rows = await this.tickets.find({
        where: {
          shopId,
          salesSystemId: system.id,
          externalId: In(ids),
        },
      });
      for (const row of rows) existingByExt.set(row.externalId, row);
    }

    const toUpdate: PosSaleTicket[] = [];
    const toInsert: PosSaleTicket[] = [];
    for (const t of uniqueTickets) {
      const fields = {
        importId: imp.id,
        businessDate: t.businessDate,
        ticketType: t.ticketType,
        total: money(t.total),
        subtotal: money(t.subtotal),
        discount: money(t.discount),
        paymentCode: t.paymentCode,
        covers: t.covers,
        externalClosingId: t.externalClosingId,
        occurredAt: t.occurredAt,
        active: true,
      };
      const existing = existingByExt.get(t.externalId);
      if (existing) {
        Object.assign(existing, fields);
        toUpdate.push(existing);
      } else {
        toInsert.push(
          this.tickets.create({
            shopId,
            salesSystemId: system.id,
            externalId: t.externalId,
            ...fields,
          }),
        );
      }
    }

    const savedTickets: PosSaleTicket[] = [];
    for (const batch of chunkArray(toUpdate, 200)) {
      savedTickets.push(...(await this.tickets.save(batch)));
    }
    for (const batch of chunkArray(toInsert, 200)) {
      savedTickets.push(...(await this.tickets.save(batch)));
    }

    const ticketByExt = new Map(savedTickets.map((t) => [t.externalId, t]));
    const ticketIds = savedTickets.map((t) => t.id);
    for (const ids of chunkArray(ticketIds, 400)) {
      await this.lines.delete({ ticketId: In(ids) });
    }

    const lineEntities: PosSaleTicketLine[] = [];
    for (const t of uniqueTickets) {
      const ticket = ticketByExt.get(t.externalId);
      if (!ticket || !t.lines.length) continue;
      for (const l of t.lines) {
        const code =
          normalizeProductCode(l.productCode) ??
          normalizeProductCode(l.productName);
        const labels = code ? labelsByCode.get(code) : null;
        lineEntities.push(
          this.lines.create({
            ticketId: ticket.id,
            productCode: normalizeProductCode(l.productCode) ?? l.productCode,
            productName: l.productName,
            category: labels?.category ?? null,
            subcategory: labels?.subcategory ?? null,
            qty: String(l.qty),
            amount: money(l.amount),
            active: true,
          }),
        );
      }
    }
    for (const batch of chunkArray(lineEntities, 500)) {
      await this.lines.save(batch);
    }

    const dayDates = preview.days.map((d) => d.businessDate);
    const existingDailies = dayDates.length
      ? await this.dailies.find({
          where: {
            shopId,
            salesSystemId: system.id,
            businessDate: In(dayDates),
          },
        })
      : [];
    const dailyByDate = new Map(
      existingDailies.map((d) => [d.businessDate, d]),
    );
    const dailiesToSave: PosSaleDaily[] = [];
    for (const day of preview.days) {
      const dailyPayload = {
        importId: imp.id,
        totalAmount: money(day.totalAmount),
        ticketCount: day.ticketCount,
        coversCount: day.coversCount,
        cashAmount: money(day.cashAmount),
        cardAmount: money(day.cardAmount),
        mercadoPagoAmount: money(day.mercadoPagoAmount),
        deliveryAppsAmount: money(day.deliveryAppsAmount),
        transferAmount: money(day.transferAmount),
        accountDniAmount: money(day.accountDniAmount),
        otherAmount: money(day.otherAmount),
        active: true,
      };
      const existing = dailyByDate.get(day.businessDate);
      if (existing) {
        Object.assign(existing, dailyPayload);
        dailiesToSave.push(existing);
      } else {
        dailiesToSave.push(
          this.dailies.create({
            shopId,
            businessDate: day.businessDate,
            salesSystemId: system.id,
            ...dailyPayload,
          }),
        );
      }
    }
    for (const batch of chunkArray(dailiesToSave, 100)) {
      await this.dailies.save(batch);
    }

    return {
      importId: imp.id,
      ...preview,
      products: [] as SalesReportProductPreview[],
      categoryOptions: [] as string[],
      geminiWarning: null as string | null,
      committedDays: preview.days.length,
    };
  }

  private async prepare(shopId: string, file: Express.Multer.File) {
    await this.seed.ensureRestosoft();
    await this.seed.ensureWeMenu();
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new BadRequestException('Local no encontrado');
    if (!shop.salesSystemId) {
      throw new BadRequestException(
        'El local no tiene sistema de ventas configurado. Asigná Restosoft / WeMenu (u otro) en Administrar local.',
      );
    }
    const system = await this.systems.findOne({ where: { id: shop.salesSystemId, active: true } });
    if (!system) throw new BadRequestException('Sistema de ventas no encontrado');

    const parser = this.parsers.get(system.parserKey);
    if (!parser.canParse(file)) {
      throw new BadRequestException(
        `El archivo no parece un reporte de ${system.name}. Verificá el formato.`,
      );
    }
    const parsed = await parser.parse(file);
    const defaults =
      system.parserKey === WEMENU_PARSER_KEY
        ? DEFAULT_WEMENU_PAYMENT_MAP
        : system.parserKey === RESTOSOFT_PARSER_KEY
          ? DEFAULT_RESTOSOFT_PAYMENT_MAP
          : { ...DEFAULT_RESTOSOFT_PAYMENT_MAP, ...DEFAULT_WEMENU_PAYMENT_MAP };
    const paymentMap = {
      ...defaults,
      ...(shop.posPaymentMap ?? {}),
    };
    return { shop, system, parsed, paymentMap };
  }

  private buildPreview(
    _shop: Shop,
    system: SalesSystem,
    file: Express.Multer.File,
    tickets: ParsedTicket[],
    parsed: { shopLabel: string | null; periodFrom: string | null; periodTo: string | null },
    paymentMap: Record<string, string>,
  ): Omit<SalesReportPreview, 'products' | 'categoryOptions' | 'geminiWarning'> {
    const byDate = new Map<
      string,
      { tickets: ParsedTicket[]; breakdown: PaymentBreakdown; unknown: Set<string> }
    >();

    for (const t of tickets) {
      let bucket = byDate.get(t.businessDate);
      if (!bucket) {
        bucket = { tickets: [], breakdown: EMPTY_BREAKDOWN(), unknown: new Set() };
        byDate.set(t.businessDate, bucket);
      }
      bucket.tickets.push(t);
      const field = this.resolvePaymentField(t.paymentCode, paymentMap);
      if (!field) {
        if (t.paymentCode) bucket.unknown.add(t.paymentCode);
        bucket.breakdown.otherAmount += t.total;
      } else {
        const key = FIELD_TO_KEY[field] ?? 'otherAmount';
        bucket.breakdown[key] += t.total;
      }
    }

    const dates = [...byDate.keys()].sort();
    const allUnknown = new Set<string>();
    const days: SalesReportDayPreview[] = dates.map((businessDate) => {
      const bucket = byDate.get(businessDate)!;
      const totalAmount = bucket.tickets.reduce((s, t) => s + t.total, 0);
      const coversCount = bucket.tickets.reduce((s, t) => s + (t.covers || 0), 0);
      for (const u of bucket.unknown) allUnknown.add(u);
      return {
        businessDate,
        ticketCount: bucket.tickets.length,
        coversCount,
        totalAmount,
        ...bucket.breakdown,
        unknownPaymentCodes: [...bucket.unknown],
      };
    });

    return {
      salesSystemCode: system.code,
      salesSystemName: system.name,
      fileName: file.originalname ?? null,
      shopLabel: parsed.shopLabel,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      ticketCount: tickets.length,
      dayCount: days.length,
      days,
      unknownPaymentCodes: [...allUnknown],
    };
  }

  private async buildProductsPreview(
    shopId: string,
    tickets: ParsedTicket[],
  ): Promise<{
    products: SalesReportProductPreview[];
    categoryOptions: string[];
    geminiWarning: string | null;
  }> {
    type Agg = {
      productCode: string;
      productName: string | null;
      qty: number;
      amount: number;
    };
    const byCode = new Map<string, Agg>();
    for (const t of tickets) {
      for (const l of t.lines) {
        const code =
          normalizeProductCode(l.productCode) ??
          normalizeProductCode(l.productName);
        if (!code) continue;
        const name = (l.productName ?? l.productCode ?? '').trim() || null;
        const existing = byCode.get(code);
        if (existing) {
          existing.qty += Number(l.qty) || 0;
          existing.amount += Number(l.amount) || 0;
          if (!existing.productName && name) existing.productName = name;
        } else {
          byCode.set(code, {
            productCode: code,
            productName: name,
            qty: Number(l.qty) || 0,
            amount: Number(l.amount) || 0,
          });
        }
      }
    }

    const codes = [...byCode.keys()];
    const catalogByCode = new Map<string, PosProduct>();
    for (const batch of chunkArray(codes, 400)) {
      if (!batch.length) continue;
      const rows = await this.products
        .createQueryBuilder('p')
        .where('p.shopId = :shopId', { shopId })
        .andWhere('p.productCode IN (:...codes)', { codes: batch })
        .getMany();
      for (const row of rows) {
        catalogByCode.set(normProductCode(row.productCode) || row.productCode, row);
      }
    }

    const categoryRows = await this.categories.find({
      where: { shopId, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const categoryOptions = [
      ...new Set([
        ...categoryRows.map((c) => c.name.trim()).filter(Boolean),
        ...SEED_CATEGORIES.map((c) => c.name),
      ]),
    ];

    const seedByCode = new Map<string, { category: string; subcategory: string }>();
    for (const p of allSeedProducts()) {
      const c = normProductCode(p.code);
      if (c) seedByCode.set(c, { category: p.category, subcategory: p.subcategory });
    }

    const resolveSeedOrHeuristic = (
      code: string,
      productName: string | null,
    ): { category: string | null; subcategory: string | null } | null => {
      const seed = seedByCode.get(code);
      if (seed?.category === 'VINOS' && !seed.subcategory) return null;
      if (seed) return { category: seed.category, subcategory: seed.subcategory };

      const wineSub = guessWineVarietyFromName(productName);
      if (wineSub) return { category: 'VINOS', subcategory: wineSub };

      if (looksLikeWineWithoutVariety(productName)) return null;

      const guess = guessByCodeRange(code);
      if (guess) return { category: guess.category, subcategory: guess.subcategory };
      return null;
    };

    const products: SalesReportProductPreview[] = [];
    const needsGemini: Array<{ productCode: string; productName: string | null }> = [];

    for (const agg of byCode.values()) {
      const catalog = catalogByCode.get(agg.productCode);
      const catalogCategory = catalog?.category?.trim() || null;
      const catalogSub = catalog?.subcategory?.trim() || null;
      const catalogOk =
        !!catalogCategory &&
        !(catalogCategory === 'VINOS' && !catalogSub);

      if (catalogOk) {
        products.push({
          productCode: agg.productCode,
          productName: catalog?.productName?.trim() || agg.productName,
          category: catalogCategory,
          subcategory: catalogSub,
          source: 'catalog',
          qty: agg.qty,
          amount: agg.amount,
        });
        continue;
      }

      const seedLabels = resolveSeedOrHeuristic(
        agg.productCode,
        agg.productName ?? catalog?.productName ?? null,
      );
      if (seedLabels?.category && (seedLabels.category !== 'VINOS' || seedLabels.subcategory)) {
        products.push({
          productCode: agg.productCode,
          productName: agg.productName ?? catalog?.productName ?? null,
          category: seedLabels.category,
          subcategory: seedLabels.subcategory,
          source: 'seed',
          qty: agg.qty,
          amount: agg.amount,
        });
        continue;
      }

      products.push({
        productCode: agg.productCode,
        productName: agg.productName ?? catalog?.productName ?? null,
        category: null,
        subcategory: null,
        source: 'none',
        qty: agg.qty,
        amount: agg.amount,
      });
      needsGemini.push({
        productCode: agg.productCode,
        productName: agg.productName ?? catalog?.productName ?? null,
      });
    }

    let geminiWarning: string | null = null;

    if (needsGemini.length) {
      const digest = {
        categories: categoryOptions,
        products: needsGemini.slice(0, 120).map((p) => ({
          productCode: p.productCode,
          productName: p.productName,
        })),
      };
      const ai = await this.gemini.suggestPosProductLabels(digest);
      if (!ai.ok) {
        geminiWarning = ai.message || 'No se pudo sugerir rubros con Gemini.';
      } else {
        const byGemini = new Map(
          ai.data.labels.map((l) => [
            normProductCode(l.productCode) || l.productCode,
            l,
          ]),
        );
        for (const p of products) {
          if (p.source !== 'none') continue;
          const g = byGemini.get(p.productCode);
          if (!g?.category) continue;
          p.category = g.category;
          p.subcategory = g.subcategory ?? null;
          if (g.productName) p.productName = g.productName;
          p.source = 'gemini';
        }
        if (ai.data.warnings?.length) {
          geminiWarning = ai.data.warnings.join(' ');
        }
      }
    }

    products.sort((a, b) => {
      const byAmount = b.amount - a.amount;
      if (byAmount !== 0) return byAmount;
      return a.productCode.localeCompare(b.productCode, 'es');
    });

    return { products, categoryOptions, geminiWarning };
  }

  private resolvePaymentField(
    code: string | null,
    map: Record<string, string>,
  ): PosPaymentField | null {
    if (!code) return null;
    const key = code.trim().toUpperCase().replace(/\s+/g, '');
    const mapped = map[key] ?? map[code.trim()];
    if (!mapped) return null;
    if (FIELD_TO_KEY[mapped]) return mapped as PosPaymentField;
    return null;
  }
}
