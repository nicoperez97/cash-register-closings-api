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
  id?: string;
  slug?: string;
  title?: string | null;
  note?: string | null;
  /** Path relativo bajo uploads/ del PDF o imagen original. */
  sourceFile?: string | null;
  sourceFileName?: string | null;
  sourceMime?: string | null;
  sections: ShopMenuSection[];
};

export type ShopMenuDoc = ShopMenu & { id: string; slug: string };

export type ShopMenusStore = {
  menus: ShopMenu[];
};

const SECTION_HINTS =
  /^(entradas?|minutas?|platos?|principales?|pastas?|pizzas?|pizze|hamburguesas?|sandwiches?|sándwiches?|paninos?|classici|speciali|vegetariano|preferito|ensaladas?|postres?|dolci|stuzzichini|aperitivi|birre|bibite|bebidas?|vinos?|vini|ivini|tragos?|cocktails?|cafés?|cafes?|cervezas?|sin tacc|sin gluten|kids?|infantil|para compartir|especiales?|del día|carta|menú|menu|picadas?|empanadas?|guarniciones?|acompañamientos?|promos?|combos?|tintos?|blancos?|rosados?|espumantes?|copas?|pinot|malbec|bonarda|cabernet|chardonnay|syrah|merlot|blend)\b/i;

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

function compactSpacedCaps(line: string): string {
  const t = line.trim();
  if (/^(?:[A-ZÁÉÍÓÚÜÑ] ){2,}[A-ZÁÉÍÓÚÜÑ]$/.test(t) && !/\d/.test(t)) {
    return t.replace(/ /g, '');
  }
  return t;
}

function looksLikeSection(line: string): boolean {
  const t = compactSpacedCaps(line.replace(/[:.\-–—]/g, '').trim());
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
    .map((l) => compactSpacedCaps(l.replace(/[·•]+/g, ' ').replace(/\.{3,}/g, ' ').replace(/\s+/g, ' ').trim()))
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

export function slugifyMenu(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function suggestMenuIdentity(
  fileName: string,
  parsed?: ShopMenu | null,
): { title: string; slug: string } {
  const n = String(fileName ?? '').toLowerCase();
  if (/vino/.test(n)) return { title: 'Vinos', slug: 'vinos' };
  if (/trago|cocktail|barra|drink|aperitiv/.test(n)) return { title: 'Tragos', slug: 'tragos' };
  if (/postre|dolci|dessert/.test(n)) return { title: 'Postres', slug: 'postres' };
  const parsedTitle = String(parsed?.title ?? '').trim();
  const fromTitle = slugifyMenu(parsedTitle);
  if (fromTitle && !/^(tutto|passa|inverno|verano|menu|carta|nuevo)$/.test(fromTitle)) {
    return { title: parsedTitle.slice(0, 80), slug: fromTitle };
  }
  return { title: parsedTitle || 'Carta', slug: 'carta' };
}

function uniqueSlug(base: string, used: Set<string>): string {
  const root = slugifyMenu(base) || 'carta';
  let slug = root;
  let n = 2;
  while (used.has(slug)) {
    slug = `${root}-${n++}`.slice(0, 40);
  }
  used.add(slug);
  return slug;
}

function newMenuId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function menuParseScore(menu: ShopMenu): number {
  let n = 0;
  for (const sec of menu.sections ?? []) {
    for (const it of sec.items ?? []) {
      const name = String(it.name ?? '').trim();
      if (name.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '').length < 4) continue;
      n += 1;
      if (it.price != null || it.priceLabel) n += 1;
      if (it.description) n += 1;
    }
  }
  return n;
}

export function menuHasItems(menu?: ShopMenu | null): boolean {
  return !!menu?.sections?.some((s) => (s.items ?? []).some((it) => String(it?.name ?? '').trim()));
}

export function normalizeShopMenu(raw?: ShopMenu | null): ShopMenu {
  const title = String(raw?.title ?? '').trim().slice(0, 80) || null;
  const note = String(raw?.note ?? '').trim().slice(0, 500) || null;
  const sourceFile = String(raw?.sourceFile ?? '').trim().replace(/\\/g, '/').slice(0, 200) || null;
  const sourceFileName = String(raw?.sourceFileName ?? '').trim().slice(0, 120) || null;
  const sourceMime = String(raw?.sourceMime ?? '').trim().slice(0, 80) || null;
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
        priceLabel: String(it?.priceLabel ?? '').trim().slice(0, 48) || null,
      });
    }
    sections.push({ name, items });
  }
  return { title, note, sourceFile, sourceFileName, sourceMime, sections };
}

const MAX_MENUS = 8;

function isLegacySingleMenu(raw: unknown): raw is ShopMenu {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as { menus?: unknown; sections?: unknown };
  return Array.isArray(o.sections) && !Array.isArray(o.menus);
}

export function normalizeShopMenus(raw?: unknown): ShopMenuDoc[] {
  const used = new Set<string>();
  const usedIds = new Set<string>();
  let list: ShopMenu[] = [];
  if (raw && typeof raw === 'object' && Array.isArray((raw as ShopMenusStore).menus)) {
    list = (raw as ShopMenusStore).menus;
  } else if (isLegacySingleMenu(raw)) {
    list = [raw];
  }
  const out: ShopMenuDoc[] = [];
  for (const item of list.slice(0, MAX_MENUS)) {
    const content = normalizeShopMenu(item);
    let id = String(item?.id ?? '').trim().slice(0, 40);
    if (!id || usedIds.has(id)) id = newMenuId();
    usedIds.add(id);
    const slug = uniqueSlug(item?.slug || content.title || 'carta', used);
    out.push({
      id,
      slug,
      title: content.title,
      note: content.note,
      sourceFile: content.sourceFile,
      sourceFileName: content.sourceFileName,
      sourceMime: content.sourceMime,
      sections: content.sections,
    });
  }
  return out;
}

export function emptyShopMenu(partial?: Partial<ShopMenu>): ShopMenuDoc {
  const identity = suggestMenuIdentity(partial?.title || 'Carta', partial as ShopMenu);
  return {
    id: partial?.id || newMenuId(),
    slug: slugifyMenu(partial?.slug || identity.slug) || 'carta',
    title: partial?.title ?? identity.title,
    note: partial?.note ?? null,
    sourceFile: partial?.sourceFile ?? null,
    sourceFileName: partial?.sourceFileName ?? null,
    sourceMime: partial?.sourceMime ?? null,
    sections: partial?.sections ?? [],
  };
}

type PdfTok = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
};

const NOISE_TOKEN =
  /^(panino|combo|simple|menú|menu|10\s*%)$/i;
const NOISE_LINE =
  /descuento|estudiante|abonando|combo incluye|chips de batata|ricetta di famiglia/i;

function isPriceToken(raw: string): boolean {
  return /^(?:\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d{4,6})(?:[.,]\d{2})?$/.test(raw.trim());
}

function isNoiseToken(tok: PdfTok): boolean {
  const s = tok.str.trim();
  return !s || NOISE_TOKEN.test(s) || NOISE_LINE.test(s);
}

function joinHyphenated(parts: string[]): string {
  let out = '';
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    if (out.endsWith('-')) out = `${out.slice(0, -1)}${p}`;
    else out = out ? `${out} ${p}` : p;
  }
  return out;
}

function dualPrice(values: string[]): { price: number | null; priceLabel: string | null } {
  const labels = values.map((v) => v.replace(/\s/g, '').replace(/^\$/, '')).filter(Boolean);
  if (!labels.length) return { price: null, priceLabel: null };
  if (labels.length === 1) {
    return { price: parsePrice(labels[0]), priceLabel: `$${labels[0]}` };
  }
  return {
    price: parsePrice(labels[0]),
    priceLabel: `$${labels[0]} / $${labels[1]}`,
  };
}

function parseMenuFromLayout(tokens: PdfTok[], _pageWidth: number): ShopMenu {
  const usable = tokens.filter((t) => t.str.trim());
  const titleTok = usable.find(
    (t) => t.h >= 32 && t.str.trim().length <= 24 && !isPriceToken(t.str) && !NOISE_LINE.test(t.str),
  );
  const title = titleTok?.str.trim() || null;

  const discount = usable
    .filter((t) => /^10\s*%$/i.test(t.str) || /descuento|estudiante|abonando/i.test(t.str))
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((t) => t.str.trim());
  const combo = usable
    .filter((t) => /combo incluye|chips de batata/i.test(t.str))
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((t) => t.str.trim());
  const note = [discount.join(' '), combo.join(' ')].filter((s) => s.trim()).join('. ') || null;

  const sectionToks = usable.filter(
    (t) =>
      t.h >= 22 &&
      t.h < 40 &&
      !isPriceToken(t.str) &&
      !isNoiseToken(t) &&
      t.str.trim().length >= 3 &&
      t.str.trim().length <= 42,
  );
  const nameToks = usable.filter((t) => {
    const letters = t.str.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    return (
      t.h >= 15.5 &&
      t.h <= 21 &&
      letters.length >= 4 &&
      !isPriceToken(t.str) &&
      !isNoiseToken(t) &&
      !looksLikeSection(t.str) &&
      !t.str.includes(',') &&
      t.str.trim().length >= 3 &&
      t.str.trim().length <= 42
    );
  });
  const priceToks = usable.filter((t) => isPriceToken(t.str));
  const descToks = usable.filter(
    (t) =>
      !isPriceToken(t.str) &&
      !isNoiseToken(t) &&
      t.h >= 8 &&
      t.h < 15.5 &&
      t.str.trim().length >= 2,
  );

  const built = nameToks.map((name) => {
    const prices = priceToks
      .filter(
        (p) =>
          p.page === name.page &&
          name.y + 12 >= p.y &&
          name.y - p.y <= 105 &&
          p.x - name.x >= 70 &&
          p.x - name.x <= 260,
      )
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const descs = descToks
      .filter(
        (d) =>
          d.page === name.page &&
          Math.abs(d.x - name.x) <= 50 &&
          name.y > d.y &&
          name.y - d.y <= 95 &&
          !nameToks.some(
            (other) =>
              other !== name &&
              other.page === name.page &&
              Math.abs(other.x - name.x) <= 50 &&
              other.y < name.y &&
              other.y > d.y,
          ),
      )
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const sameColSections = sectionToks.filter(
      (s) => s.page === name.page && s.y > name.y && Math.abs(s.x - name.x) <= 90,
    );
    const anySections = sectionToks.filter((s) => s.page === name.page && s.y > name.y);
    const sectionPool = sameColSections.length ? sameColSections : anySections;
    sectionPool.sort((a, b) => a.y - b.y);
    const section = sectionPool[0];
    const priced = dualPrice(prices.map((p) => p.str));
    return {
      name,
      section: section?.str.replace(/[:.]+$/, '').trim() || 'Carta',
      item: {
        name: name.str.trim(),
        description: joinHyphenated(descs.map((d) => d.str)) || null,
        price: priced.price,
        priceLabel: priced.priceLabel,
      } satisfies ShopMenuItem,
    };
  });

  built.sort((a, b) => {
    if (a.name.page !== b.name.page) return a.name.page - b.name.page;
    if (Math.abs(a.name.y - b.name.y) > 22) return b.name.y - a.name.y;
    return a.name.x - b.name.x;
  });

  const sections: ShopMenuSection[] = [];
  const byName = new Map<string, ShopMenuSection>();
  const order: string[] = [];
  for (const row of built) {
    let sec = byName.get(row.section);
    if (!sec) {
      sec = { name: row.section, items: [] };
      byName.set(row.section, sec);
      order.push(row.section);
    }
    sec.items.push(row.item);
  }
  for (const key of order) {
    const sec = byName.get(key);
    if (sec?.items.length) sections.push(sec);
  }
  return {
    title,
    note,
    sections: sections.length ? sections : [{ name: 'Carta', items: [] }],
  };
}

async function extractPdfLayout(buffer: Buffer): Promise<{
  pageWidth: number;
  tokens: PdfTok[];
}> {
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
  const tokens: PdfTok[] = [];
  let pageWidth = 595;
  const maxPages = Math.min(doc.numPages, 8);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    if (i === 1) pageWidth = viewport.width;
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!item || typeof item !== 'object' || !('str' in item)) continue;
      const str = String((item as { str?: string }).str ?? '').replace(/\s+/g, ' ').trim();
      if (!str) continue;
      const transform = (item as { transform?: number[] }).transform;
      const x = Array.isArray(transform) ? Number(transform[4]) : 0;
      const y = Array.isArray(transform) ? Number(transform[5]) : 0;
      const w = Number((item as { width?: number }).width ?? 0);
      const h = Number((item as { height?: number }).height ?? 0);
      tokens.push({ str, x, y, w, h, page: i });
    }
  }
  return { pageWidth, tokens };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { tokens } = await extractPdfLayout(buffer);
  return tokensToNaiveLines(tokens);
}

function tokensToNaiveLines(tokens: PdfTok[]): string {
  const parts: string[] = [];
  const sorted = [...tokens].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  let line = '';
  let lastY: number | null = null;
  let lastPage = 1;
  for (const tok of sorted) {
    if (tok.page !== lastPage) {
      if (line.trim()) parts.push(line.trim());
      parts.push('');
      line = '';
      lastY = null;
      lastPage = tok.page;
    }
    if (lastY != null && Math.abs(tok.y - lastY) > 3.5) {
      if (line.trim()) parts.push(line.trim());
      line = '';
    }
    line += (line ? ' ' : '') + tok.str;
    lastY = tok.y;
  }
  if (line.trim()) parts.push(line.trim());
  return parts.join('\n');
}

function menuToRawText(menu: ShopMenu): string {
  const lines: string[] = [];
  if (menu.title) lines.push(menu.title);
  if (menu.note) lines.push(menu.note);
  for (const sec of menu.sections) {
    lines.push('');
    lines.push(sec.name);
    for (const it of sec.items) {
      const price = it.priceLabel || (it.price != null ? `$${it.price}` : '');
      lines.push(price ? `${it.name}  ${price}` : it.name);
      if (it.description) lines.push(it.description);
    }
  }
  return lines.join('\n').trim();
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
  if (isPdf(file)) {
    try {
      const { tokens, pageWidth } = await extractPdfLayout(file.buffer);
      const spatial = parseMenuFromLayout(tokens, pageWidth);
      const naive = tokensToNaiveLines(tokens);
      const textual = parseMenuText(naive);
      const useSpatial = menuParseScore(spatial) >= 6 && menuParseScore(spatial) >= menuParseScore(textual);
      const parsed = useSpatial ? spatial : textual;
      if (menuHasItems(parsed)) {
        const identity = suggestMenuIdentity(file.originalname || '', parsed);
        return {
          menu: {
            ...parsed,
            title: parsed.title || identity.title,
            slug: identity.slug,
          },
          rawText: (useSpatial ? menuToRawText(spatial) : naive).slice(0, 12000),
        };
      }
    } catch {
      // seguimos con OCR / texto
    }
  }
  const rawText = await extractMenuFileText(file);
  const parsed = parseMenuText(rawText);
  const identity = suggestMenuIdentity(file.originalname || '', parsed);
  return {
    menu: {
      ...parsed,
      title: parsed.title || identity.title,
      slug: identity.slug,
    },
    rawText: rawText.slice(0, 12000),
  };
}
