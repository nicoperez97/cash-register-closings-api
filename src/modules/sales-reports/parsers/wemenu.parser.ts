import { BadRequestException } from '@nestjs/common';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { recognize } from 'tesseract.js';
import {
  ParsedSalesReport,
  ParsedTicket,
  SalesSystemParser,
} from './sales-system-parser';
import { WEMENU_PARSER_KEY } from '../../../common/sales-systems-seed.service';

function ensureDomPolyfills() {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
  if (!g.ImageData) g.ImageData = ImageData;
  if (!g.Path2D) g.Path2D = Path2D;
}

function normText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/** Parsea montos estilo UY: 9.150.300,00 */
function parseUyMoney(raw: string): number {
  const s = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function isPdf(file: Express.Multer.File): boolean {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf')) return true;
  const mime = (file.mimetype || '').toLowerCase();
  if (mime === 'application/pdf' || mime === 'application/x-pdf') return true;
  const buf = file.buffer;
  if (buf?.length >= 4 && buf.subarray(0, 4).toString('utf8') === '%PDF') return true;
  return false;
}

/**
 * Parser WeMenu — PDF del dashboard (screenshot) con KPIs del período.
 * Extrae Desde/Hasta, ingresos totales, pedidos y descuentos vía OCR.
 * No interpreta las barras verticales de forma de pago.
 */
export class WemenuParser implements SalesSystemParser {
  readonly key = WEMENU_PARSER_KEY;

  canParse(file: Express.Multer.File): boolean {
    return isPdf(file);
  }

  async parse(file: Express.Multer.File): Promise<ParsedSalesReport> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo vacío');
    }
    if (!isPdf(file)) {
      throw new BadRequestException('El reporte WeMenu debe ser un PDF');
    }

    const ocrText = await this.ocrFirstPage(file.buffer);
    const text = normText(ocrText);

    const hasMarker =
      text.includes('FILTRAR PERIODO') ||
      text.includes('INGRESOS TOTALES') ||
      text.includes('PEDIDOS TOTALES') ||
      text.includes('TOTALES POR FORMA DE PAGO');
    if (!hasMarker) {
      throw new BadRequestException(
        'No se reconoció un reporte WeMenu (faltan marcadores del dashboard)',
      );
    }

    const dates = [...ocrText.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
    const periodFrom = dates[0] ?? null;
    const periodTo = dates[1] ?? dates[0] ?? null;
    if (!periodTo) {
      throw new BadRequestException('No se encontraron fechas Desde/Hasta en el PDF');
    }

    const moneyRe = /(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/g;
    const allMoney = [...ocrText.matchAll(moneyRe)].map((m) => ({
      raw: m[1],
      value: parseUyMoney(m[1]),
      index: m.index ?? 0,
    }));

    // Map OCR index: search DESCUENTOS in original with flexible accents
    const descuentosRawMatch = ocrText.search(/DESCUENTOS/i);
    const cut = descuentosRawMatch >= 0 ? descuentosRawMatch : ocrText.length;

    const beforeDiscount = allMoney.filter((m) => m.index < cut);
    let ingresos = beforeDiscount.reduce((max, m) => (m.value > max ? m.value : max), 0);
    if (!ingresos) {
      ingresos = allMoney.reduce((max, m) => (m.value > max ? m.value : max), 0);
    }
    if (!ingresos) {
      throw new BadRequestException('No se pudo leer Ingresos totales del PDF WeMenu');
    }

    let descuentos = 0;
    const afterDiscount = allMoney.filter((m) => m.index >= cut);
    if (afterDiscount.length) descuentos = afterDiscount[0].value;

    let pedidos = 0;
    const pedidosBlock = text.match(
      /PEDIDOS\s*TOTALES[\s\S]{0,120}?\$?\s*(\d{1,6})\s+(\d{1,6})\s+(\d{1,6})/,
    );
    if (pedidosBlock) {
      pedidos = Number(pedidosBlock[3]) || 0;
    } else {
      const triple = ocrText.match(/\$\s*(\d{1,6})\s+(\d{1,6})\s+(\d{1,6})\b/);
      if (triple) pedidos = Number(triple[3]) || 0;
    }

    const ticket: ParsedTicket = {
      businessDate: periodTo,
      externalId: `WEMENU-${periodFrom ?? periodTo}-${periodTo}`,
      ticketType: 'WEMENU',
      total: ingresos,
      subtotal: Math.max(0, ingresos - descuentos),
      discount: descuentos,
      paymentCode: 'TOTAL',
      covers: pedidos,
      externalClosingId: null,
      occurredAt: null,
      lines: [],
    };

    return {
      shopLabel: 'WeMenu',
      periodFrom,
      periodTo,
      tickets: [ticket],
    };
  }

  private async ocrFirstPage(buffer: Buffer): Promise<string> {
    ensureDomPolyfills();

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerPath = path.join(
      path.dirname(require.resolve('pdfjs-dist/package.json')),
      'legacy/build/pdf.worker.mjs',
    );
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    }).promise;

    if (!doc.numPages) {
      throw new BadRequestException('El PDF no tiene páginas');
    }

    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    const png = canvas.toBuffer('image/png');
    const result = await recognize(png, 'spa');
    return result.data.text || '';
  }
}
