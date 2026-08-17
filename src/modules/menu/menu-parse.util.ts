import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { recognize } from 'tesseract.js';

export type ShopMenuItem = {
  name: string;
  description?: string | null;
  price?: number | null;
  priceLabel?: string | null;
};

export type ShopMenuSection = {
  name: string;
  items: ShopMenuItem[];
};

export type ShopMenu = {
  title?: string | null;
  note?: string | null;
  sections: ShopMenuSection[];
};

const SECTION_HINTS =
  /^(entradas?|minutas?|platos?|principales?|pastas?|pizzas?|hamburguesas?|sandwiches?|sándwiches?|ensaladas?|postres?|bebidas?|vinos?|tragos?|cocktails?|cafés?|cafes?|cervezas?|sin tacc|sin gluten|kids?|infantil|para compartir|especiales?|del día|carta|menú|menu|picadas?|empanadas?|guarniciones?|acompañamientos?|promos?|combos?)\b/i;

const PRICE_TAIL =
  /(?:\$|ars)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{2})?)\s*(?:\.|-|—|–)?\s*$/i;

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
  return !!(buf?.length >= 4 && buf.subarray(0, 4).toString('utf8') === '%PDF');
}

function isImage(file: Express.Multer.File): boolean {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = (file.originalname || '').toLowerCase();
  return /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name);
}

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  if (cleaned.includes(',')) {
    const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    const n = Number(cleaned.replace(/\./g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function looksLikeSection(line: string): boolean {
  const t = line.replace(/[:.\-–—]/g, '').trim();
  if (t.length < 2 || t.length > 42) return false;
  if (PRICE_TAIL.test(line)) return false;
  if (/\d/.test(t) && t.length > 8) return false;
  if (SECTION_HINTS.test(t)) return true;
  const letters = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letters.length < 3) return false;
  const upper = letters === letters.toUpperCase() && letters.length >= 4;
  return upper;
}

export function parseMenuText(raw: string): ShopMenu {
  const lines = String(raw ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[·•]+/g, ' ').replace(/\.{3,}/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^página\s+\d+/i.test(l));

  const sections: ShopMenuSection[] = [];
  let current: ShopMenuSection = { name: 'Carta', items: [] };
  let title: string | null = null;

  const flush = () => {
    if (current.items.length) sections.push(current);
  };

  for (const line of lines) {
    if (!title && line.length <= 48 && !PRICE_TAIL.test(line) && sections.length === 0 && !current.items.length) {
      if (/carta|menú|menu|tutto|inverno|verano/i.test(line)) {
        title = line;
        continue;
      }
    }
    if (looksLikeSection(line)) {
      flush();
      current = { name: line.replace(/[:.]+$/, '').trim(), items: [] };
      continue;
    }
    const priceMatch = line.match(PRICE_TAIL);
    if (priceMatch) {
      const name = line.slice(0, priceMatch.index).replace(/[-–—:]+$/, '').trim();
      if (name.length < 2) continue;
      const priceLabel = `$${priceMatch[1]}`;
      current.items.push({
        name,
        description: null,
        price: parsePrice(priceMatch[1]),
        priceLabel,
      });
      continue;
    }
    const last = current.items[current.items.length - 1];
    if (last && line.length <= 140 && !looksLikeSection(line)) {
      last.description = last.description ? `${last.description} ${line}` : line;
    }
  }
  flush();
  if (!sections.length && current.items.length) sections.push(current);
  return {
    title,
    note: null,
    sections: sections.length ? sections : [{ name: 'Carta', items: [] }],
  };
}

export function normalizeShopMenu(raw?: ShopMenu | null): ShopMenu {
  const title = String(raw?.title ?? '').trim().slice(0, 80) || null;
  const note = String(raw?.note ?? '').trim().slice(0, 500) || null;
  const sections: ShopMenuSection[] = [];
  for (const sec of raw?.sections ?? []) {
    const name = String(sec?.name ?? '').trim().slice(0, 60);
    if (!name) continue;
    const items: ShopMenuItem[] = [];
    for (const it of sec.items ?? []) {
      const itemName = String(it?.name ?? '').trim().slice(0, 120);
      if (!itemName) continue;
      const price = it?.price == null || it.price === ('' as unknown) ? null : Number(it.price);
      items.push({
        name: itemName,
        description: String(it?.description ?? '').trim().slice(0, 400) || null,
        price: Number.isFinite(price) && price != null && price >= 0 ? price : null,
        priceLabel: String(it?.priceLabel ?? '').trim().slice(0, 24) || null,
      });
    }
    sections.push({ name, items });
  }
  return { title, note, sections };
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
  const maxPages = Math.min(doc.numPages, 8);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!item || typeof item !== 'object' || !('str' in item)) continue;
      const str = String((item as { str?: string }).str ?? '');
      const transform = (item as { transform?: number[] }).transform;
      const y = Array.isArray(transform) ? Number(transform[5]) : 0;
      if (lastY != null && Math.abs(y - lastY) > 3.5) {
        if (line.trim()) parts.push(line.trim());
        line = '';
      }
      line += (line ? ' ' : '') + str;
      lastY = y;
    }
    if (line.trim()) parts.push(line.trim());
    parts.push('');
  }
  return parts.join('\n');
}

async function ocrPdfPages(buffer: Buffer, maxPages = 4): Promise<string> {
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
  const pages = Math.min(doc.numPages, maxPages);
  const chunks: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    const png = canvas.toBuffer('image/png');
    const result = await recognize(png, 'spa');
    chunks.push(String(result.data?.text ?? ''));
  }
  return chunks.join('\n');
}

export async function extractMenuFileText(file: Express.Multer.File): Promise<string> {
  if (isPdf(file)) {
    let text = '';
    try {
      text = await extractPdfText(file.buffer);
    } catch {
      text = '';
    }
    if (text.replace(/\s+/g, '').length >= 80) return text;
    return ocrPdfPages(file.buffer);
  }
  if (isImage(file) || (file.originalname || '').toLowerCase().endsWith('.txt')) {
    if ((file.originalname || '').toLowerCase().endsWith('.txt') || (file.mimetype || '').startsWith('text/')) {
      return file.buffer.toString('utf8');
    }
    const result = await recognize(file.buffer, 'spa');
    return String(result.data?.text ?? '');
  }
  throw new Error('Usá un PDF, una imagen o un .txt');
}

export async function parseMenuFile(file: Express.Multer.File): Promise<{
  menu: ShopMenu;
  rawText: string;
}> {
  const rawText = await extractMenuFileText(file);
  return { menu: parseMenuText(rawText), rawText: rawText.slice(0, 12000) };
}
