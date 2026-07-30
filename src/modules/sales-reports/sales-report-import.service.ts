import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { ClosingStatus } from '../../common/enums';
import {
  DEFAULT_RESTOSOFT_PAYMENT_MAP,
  SalesSystemsSeedService,
} from '../../common/sales-systems-seed.service';
import { CashClosing } from '../../entities/cash-closing.entity';
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
const n = (v?: string | number | null) => Number(v ?? 0);

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
  closingExists: boolean;
  closingId: string | null;
  closingLocked: boolean;
  previousPosSystemAmount: number | null;
  posMismatch: boolean;
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
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
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
    return this.buildPreview(shopId, shop, system, file, parsed.tickets, parsed, paymentMap);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const { system, shop, parsed, paymentMap } = await this.prepare(shopId, file);
    const preview = await this.buildPreview(
      shopId,
      shop,
      system,
      file,
      parsed.tickets,
      parsed,
      paymentMap,
    );

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

    const allLineItems = parsed.tickets.flatMap((t) => t.lines);
    const labelsByCode = await this.productsAnalytics.upsertFromLines(shopId, allLineItems);

    // Upsert tickets + lines
    for (const t of parsed.tickets) {
      let ticket = await this.tickets.findOne({
        where: {
          shopId,
          salesSystemId: system.id,
          externalId: t.externalId,
        },
      });
      if (ticket) {
        Object.assign(ticket, {
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
        });
        await this.tickets.save(ticket);
        await this.lines.delete({ ticketId: ticket.id });
      } else {
        ticket = await this.tickets.save(
          this.tickets.create({
            shopId,
            importId: imp.id,
            salesSystemId: system.id,
            businessDate: t.businessDate,
            externalId: t.externalId,
            ticketType: t.ticketType,
            total: money(t.total),
            subtotal: money(t.subtotal),
            discount: money(t.discount),
            paymentCode: t.paymentCode,
            covers: t.covers,
            externalClosingId: t.externalClosingId,
            occurredAt: t.occurredAt,
            active: true,
          }),
        );
      }
      if (t.lines.length) {
        await this.lines.save(
          t.lines.map((l) => {
            const rawCode = (l.productCode || l.productName || '').trim();
            const code = /^\d+\.0+$/.test(rawCode)
              ? String(parseInt(rawCode, 10))
              : rawCode.replace(/\.0+$/, '');
            const labels = code ? labelsByCode.get(code) : null;
            return this.lines.create({
              ticketId: ticket!.id,
              productCode: l.productCode
                ? (/^\d+\.0+$/.test(String(l.productCode).trim())
                    ? String(parseInt(String(l.productCode), 10))
                    : String(l.productCode).trim().replace(/\.0+$/, ''))
                : l.productCode,
              productName: l.productName,
              category: labels?.category ?? null,
              subcategory: labels?.subcategory ?? null,
              qty: String(l.qty),
              amount: money(l.amount),
              active: true,
            });
          }),
        );
      }
    }

    // Upsert dailies + closings
    for (const day of preview.days) {
      if (day.closingLocked) continue;

      let daily = await this.dailies.findOne({
        where: {
          shopId,
          businessDate: day.businessDate,
          salesSystemId: system.id,
        },
      });
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
      if (daily) {
        Object.assign(daily, dailyPayload);
        await this.dailies.save(daily);
      } else {
        await this.dailies.save(
          this.dailies.create({
            shopId,
            businessDate: day.businessDate,
            salesSystemId: system.id,
            ...dailyPayload,
          }),
        );
      }

      await this.applyToClosing(user, shopId, day);
    }

    return {
      importId: imp.id,
      ...preview,
      committedDays: preview.days.filter((d) => !d.closingLocked).length,
      skippedLockedDays: preview.days.filter((d) => d.closingLocked).length,
    };
  }

  private async prepare(shopId: string, file: Express.Multer.File) {
    await this.seed.ensureRestosoft();
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new BadRequestException('Local no encontrado');
    if (!shop.salesSystemId) {
      throw new BadRequestException(
        'El local no tiene sistema de ventas configurado. Asigná Restosoft (u otro) en Administrar local.',
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
    const parsed = parser.parse(file);
    const paymentMap = {
      ...DEFAULT_RESTOSOFT_PAYMENT_MAP,
      ...(shop.posPaymentMap ?? {}),
    };
    return { shop, system, parsed, paymentMap };
  }

  private async buildPreview(
    shopId: string,
    _shop: Shop,
    system: SalesSystem,
    file: Express.Multer.File,
    tickets: ParsedTicket[],
    parsed: { shopLabel: string | null; periodFrom: string | null; periodTo: string | null },
    paymentMap: Record<string, string>,
  ): Promise<SalesReportPreview> {
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
    const existing = dates.length
      ? await this.closings.find({
          where: { shopId, businessDate: In(dates), active: true },
        })
      : [];
    const closingByDate = new Map(existing.map((c) => [c.businessDate, c]));

    const allUnknown = new Set<string>();
    const days: SalesReportDayPreview[] = dates.map((businessDate) => {
      const bucket = byDate.get(businessDate)!;
      const totalAmount = bucket.tickets.reduce((s, t) => s + t.total, 0);
      const coversCount = bucket.tickets.reduce((s, t) => s + (t.covers || 0), 0);
      for (const u of bucket.unknown) allUnknown.add(u);
      const closing = closingByDate.get(businessDate);
      const previousPos = closing ? n(closing.posSystemAmount) : null;
      return {
        businessDate,
        ticketCount: bucket.tickets.length,
        coversCount,
        totalAmount,
        ...bucket.breakdown,
        closingExists: !!closing,
        closingId: closing?.id ?? null,
        closingLocked: closing?.status === ClosingStatus.LOCKED,
        previousPosSystemAmount: previousPos,
        posMismatch:
          previousPos != null && Math.abs(previousPos - totalAmount) > 0.009,
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

  private async applyToClosing(user: AuthUser, shopId: string, day: SalesReportDayPreview) {
    let row = await this.closings.findOne({
      where: { shopId, businessDate: day.businessDate, active: true },
    });

    const calculated =
      day.cardAmount +
      day.cashAmount +
      day.mercadoPagoAmount +
      day.deliveryAppsAmount +
      day.transferAmount +
      day.accountDniAmount +
      day.otherAmount;
    const averageTicket =
      day.ticketCount > 0 ? day.totalAmount / day.ticketCount : null;

    if (!row) {
      row = this.closings.create({
        shopId,
        businessDate: day.businessDate,
        posSystemAmount: money(day.totalAmount),
        cardAmount: money(day.cardAmount),
        cashAmount: money(day.cashAmount),
        mercadoPagoAmount: money(day.mercadoPagoAmount),
        deliveryAppsAmount: money(day.deliveryAppsAmount),
        transferAmount: money(day.transferAmount),
        accountDniAmount: money(day.accountDniAmount),
        otherAmount: money(day.otherAmount),
        unitsSold: day.ticketCount,
        coversCount: day.coversCount || null,
        averageTicket: averageTicket != null ? money(averageTicket) : null,
        cashLeftInRegister: money(0),
        cashPendingPickup: money(0),
        cashWithdrawn: money(0),
        tipsAmount: money(0),
        declaredTotal: money(calculated),
        calculatedTotal: money(calculated),
        difference: money(day.totalAmount - calculated),
        notes: '[Importado POS]',
        status: ClosingStatus.DRAFT,
        createdByUserId: user.id,
        submittedAt: null,
        active: true,
      });
      await this.closings.save(row);
      return;
    }

    if (row.status === ClosingStatus.LOCKED) return;

    row.posSystemAmount = money(day.totalAmount);
    row.cardAmount = money(day.cardAmount);
    row.cashAmount = money(day.cashAmount);
    row.mercadoPagoAmount = money(day.mercadoPagoAmount);
    row.deliveryAppsAmount = money(day.deliveryAppsAmount);
    row.transferAmount = money(day.transferAmount);
    row.accountDniAmount = money(day.accountDniAmount);
    row.otherAmount = money(day.otherAmount);
    row.unitsSold = day.ticketCount;
    row.coversCount = day.coversCount || row.coversCount;
    row.averageTicket = averageTicket != null ? money(averageTicket) : row.averageTicket;
    row.calculatedTotal = money(calculated);
    // Keep declaredTotal if user already set it differently; else align to medios
    if (n(row.declaredTotal) === 0) {
      row.declaredTotal = money(calculated);
    }
    row.difference = money(n(row.posSystemAmount) - n(row.declaredTotal));
    if (!row.notes?.includes('[Importado POS]')) {
      row.notes = [row.notes, '[Importado POS]'].filter(Boolean).join(' ').trim();
    }
    await this.closings.save(row);
  }
}
