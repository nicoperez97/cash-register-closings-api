import { BadRequestException } from '@nestjs/common';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { recognize } from 'tesseract.js';

export type ParsedInvoice = {
  legalName: string | null;
  taxId: string | null;
  invoiceType: string | null;
  invoiceNumber: string | null;
  netAmount: number | null;
  ivaAmount: number | null;
  perceptionsAmount: number | null;
  otherTaxesAmount: number | null;
  totalAmount: number | null;
  rawText: string;
};

function ensureDomPolyfills() {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
  if (!g.ImageData) g.ImageData = ImageData;
  if (!g.Path2D) g.Path2D = Path2D;
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

function isImage(file: Express.Multer.File): boolean {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = (file.originalname || '').toLowerCase();
  return /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name);
}

function clean(s: string | null | undefined): string | null {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v || null;
}

function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // AR: 516.367,50 o US: 516,367.50
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      s = parts[0].replace(/\./g, '') + '.' + parts[1];
    } else {
      s = s.replace(/,/g, '');
    }
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Captura montos tipo 1.234.567,89 / 1,234,567.89 / 1234.56 */
const MONEY_CAPTURE = String.raw`(\d{1,3}(?:[.\s]\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[.,]\d{2}|\d+)`;

function extractMoneyAfter(flat: string, labelRe: RegExp): number | null {
  const re = new RegExp(labelRe.source + String.raw`\s*\$?\s*` + MONEY_CAPTURE, labelRe.flags.includes('i') ? 'i' : undefined);
  const m = flat.match(re);
  return parseMoney(m?.[1] ?? null);
}

function normalizeCuit(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
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

  const parts: string[] = [];
  const maxPages = Math.min(doc.numPages || 0, 3);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ('str' in it ? String(it.str || '') : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) parts.push(pageText);
  }
  return parts.join('\n').trim();
}

async function ocrPdfFirstPage(buffer: Buffer): Promise<string> {
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
  if (!doc.numPages) throw new BadRequestException('El PDF no tiene páginas');

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

async function ocrImage(buffer: Buffer): Promise<string> {
  const result = await recognize(buffer, 'spa');
  return result.data.text || '';
}

async function readFileText(file: Express.Multer.File): Promise<string> {
  if (!file?.buffer?.length) throw new BadRequestException('Archivo vacío');
  if (!isPdf(file) && !isImage(file)) {
    throw new BadRequestException(
      `El archivo "${file.originalname || 'sin nombre'}" debe ser imagen (JPG/PNG/WebP) o PDF`,
    );
  }
  try {
    if (isPdf(file)) {
      const text = await extractPdfText(file.buffer);
      if (text && text.length >= 40) return text;
      return await ocrPdfFirstPage(file.buffer);
    }
    return await ocrImage(file.buffer);
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException(
      `No se pudo leer el texto de "${file.originalname || 'archivo'}"`,
    );
  }
}

const AFIP_TYPE_BY_CODE: Record<string, string> = {
  '1': 'A',
  '6': 'B',
  '11': 'C',
  '51': 'M',
  '19': 'E',
};

export function parseInvoiceText(rawText: string): ParsedInvoice {
  const text = (rawText || '').replace(/\r/g, '\n');
  const flat = text.replace(/\s+/g, ' ').trim();

  let invoiceType: string | null = null;
  let invoiceNumber: string | null = null;

  const letterNum = flat.match(
    /\b([ABCEM])\s*N[º°oO.]{0,2}\s*[:.]?\s*(\d{4})\s*[-–]\s*(\d{5,8})\b/i,
  );
  if (letterNum) {
    invoiceType = letterNum[1].toUpperCase();
    invoiceNumber = `${letterNum[2]}-${letterNum[3]}`;
  }

  if (!invoiceType) {
    const codeMatch = flat.match(/\bCod\.?\s*Nro\.?\s*[:.]?\s*(\d{1,3})\b/i);
    if (codeMatch) invoiceType = AFIP_TYPE_BY_CODE[String(Number(codeMatch[1]))] ?? null;
  }

  if (!invoiceType) {
    const facturaLetter = flat.match(/\bFACTURA\s+([ABCEM])(?:\s+N|\s*$)/i);
    if (facturaLetter) invoiceType = facturaLetter[1].toUpperCase();
  }

  if (!invoiceNumber) {
    const numMatch =
      flat.match(/\bN[º°oO.]{0,2}\s*[:.]?\s*(\d{4})\s*[-–]\s*(\d{5,8})\b/i) ||
      flat.match(/\b(\d{4})\s*[-–]\s*(\d{5,8})\b/);
    if (numMatch) {
      invoiceNumber = `${numMatch[1]}-${numMatch[2]}`;
    }
  }

  const cuits: string[] = [];
  const cuitRe = /C\.?\s*U\.?\s*I\.?\s*T\.?\s*[:.]?\s*(\d{2}[-\s]?\d{8}[-\s]?\d)/gi;
  let m: RegExpExecArray | null;
  while ((m = cuitRe.exec(flat))) {
    const c = normalizeCuit(m[1]);
    if (c && !cuits.includes(c)) cuits.push(c);
  }
  // Primer CUIT suele ser del emisor (proveedor)
  const taxId = cuits[0] ?? null;

  let legalName: string | null = null;
  const srlMatch = flat.match(
    /\b((?:[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ0-9 .,&'\-]{2,60}?)\s(?:S\.?R\.?L\.?|S\.?A\.?S\.?|S\.?A\.?))\b/,
  );
  if (srlMatch) {
    legalName = clean(srlMatch[1]);
    // Evitar arrastrar CUIT u otros números al inicio
    legalName = legalName?.replace(/^\d{2}-\d{8}-\d\s*/g, '').trim() || null;
  }
  if (!legalName) {
    const distMatch = flat.match(
      /\b(Distribuidora[A-ZÁÉÍÓÚÑa-záéíóúñ0-9 .,&'\-]{3,50}(?:S\.?R\.?L\.?|S\.?A\.?)?)\b/i,
    );
    if (distMatch) legalName = clean(distMatch[1]);
  }

  const totalAmount =
    extractMoneyAfter(flat, /\bTOTAL\b/i) ??
    extractMoneyAfter(flat, /\bIMPORTE\s+TOTAL\b/i);

  let netAmount = extractMoneyAfter(
    flat,
    /\b(?:NETO|SUBTOTAL|GRAVADO|IMPORTE\s+NETO)\b/i,
  );

  // Evitar tomar "Per.IVA 0.00" como IVA de la factura
  let ivaAmount: number | null = null;
  const ivaLabeled = flat.match(
    new RegExp(
      String.raw`\b(?:IVA\s+(?:TOTAL|21%|10[,.]5%|27%)|I\.?V\.?A\.?\s*(?:21%|10[,.]5%|27%))\s*\$?\s*` +
        MONEY_CAPTURE,
      'i',
    ),
  );
  if (ivaLabeled) ivaAmount = parseMoney(ivaLabeled[1]);

  let perceptionsAmount = 0;
  let foundPerception = false;
  const percRe = new RegExp(
    String.raw`Per(?:cep(?:ciones?)?)?\.?\s*(?:IVA|IIBB|I\.?I\.?B\.?B\.?)[^\d$]{0,20}\$?\s*` +
      MONEY_CAPTURE,
    'gi',
  );
  while ((m = percRe.exec(flat))) {
    const v = parseMoney(m[1]);
    if (v != null) {
      perceptionsAmount += v;
      foundPerception = true;
    }
  }
  if (!foundPerception) {
    const block = flat.match(
      new RegExp(
        String.raw`Per\.?\s*IVA[\s\S]{0,120}?((?:\d+[.,]\d{2}\s*){1,6})`,
        'i',
      ),
    );
    if (block?.[1]) {
      const nums = block[1].match(/\d+[.,]\d{2}/g) || [];
      for (const n of nums) {
        const v = parseMoney(n);
        if (v != null) {
          perceptionsAmount += v;
          foundPerception = true;
        }
      }
    }
  }

  const otherTaxesAmount = extractMoneyAfter(
    flat,
    /\b(?:OTROS?\s+IMPUESTOS?|IMPUESTOS?\s+INTERNOS?|IMP\.\s*INT)\b/i,
  );

  // Si hay total e IVA 21% implícito en ítems pero sin neto/IVA explícitos
  if (totalAmount != null && netAmount == null && ivaAmount == null) {
    const hasIva21 =
      /21(?:[.,]00)?\s*%/.test(flat) ||
      /%\s*IVA\s*21/i.test(flat) ||
      (/\bI\.?V\.?A\.?\b/i.test(flat) && /\b21(?:[.,]00)\b/.test(flat)) ||
      (invoiceType === 'A' || invoiceType === 'B');
    if (hasIva21) {
      netAmount = Math.round((totalAmount * 100) / 121) / 100;
      ivaAmount = Math.round((totalAmount - netAmount) * 100) / 100;
    }
  }

  return {
    legalName,
    taxId,
    invoiceType,
    invoiceNumber,
    netAmount,
    ivaAmount,
    perceptionsAmount: foundPerception ? Math.round(perceptionsAmount * 100) / 100 : null,
    otherTaxesAmount,
    totalAmount,
    rawText: text.trim(),
  };
}

export async function ocrAndParseInvoice(
  file: Express.Multer.File,
): Promise<ParsedInvoice> {
  const rawText = (await readFileText(file)).trim();
  if (!rawText) {
    throw new BadRequestException('No se detectó texto en la imagen/PDF');
  }
  return parseInvoiceText(rawText);
}
