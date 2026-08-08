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
import { PosSaleDaily } from '../../entities/pos-sale-daily.entity';
import { PosSaleImport } from '../../entities/pos-sale-import.entity';
import { PosSaleTicket } from '../../entities/pos-sale-ticket.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { SalesSystem } from '../../entities/sales-system.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { SalesParserRegistry } from './parsers/parser-registry';
import { ParsedTicket } from './parsers/sales-system-parser';
import type { PosPaymentField } from './parsers/sales-system-parser';
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
    private readonly shops: ShopsService,
    private readonly parsers: SalesParserRegistry,
    private readonly seed: SalesSystemsSeedService,
    private readonly productsAnalytics: SalesProductsAnalyticsService,
  ) {}

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File): Promise<SalesReportPreview> {
    this.shops.assertShopAccess(user, shopId);
    const { system, shop, parsed, paymentMap } = await this.prepare(shopId, file);
    return this.buildPreview(shop, system, file, parsed.tickets, parsed, paymentMap);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
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
  ): SalesReportPreview {
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
