import { PDFDocument, StandardFonts, rgb, RGB } from 'pdf-lib';
import type { MenuPriceSlot, ShopMenuItem } from './menu-parse.util';

function parseAccent(hex?: string | null): RGB {
  const m = String(hex || '#1c3a5d')
    .trim()
    .match(/^#?([0-9a-f]{6})$/i);
  if (!m) return rgb(0.11, 0.23, 0.36);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Formato AR simple: $1.200 (sin decimales). */
export function formatMenuPdfPrice(item: {
  price?: number | null;
  priceLabel?: string | null;
}): string {
  const label = String(item.priceLabel ?? '').trim();
  if (label) return label.slice(0, 24);
  if (item.price == null || !Number.isFinite(Number(item.price))) return '';
  const n = Math.round(Number(item.price));
  const body = n.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `$${body}`;
}

function winAnsi(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '?');
}

/**
 * Carga el PDF físico y dibuja los precios vivos en cada slot.
 * Coordenadas: origen abajo-izquierda, unidades pt (pdf-lib).
 */
export async function buildPricedMenuPdf(opts: {
  sourceBytes: Uint8Array | Buffer;
  slots: MenuPriceSlot[];
  itemsById: Map<string, ShopMenuItem>;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(opts.sourceBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const slot of opts.slots) {
    const item = opts.itemsById.get(slot.itemId);
    if (!item) continue;
    const text = formatMenuPdfPrice(item);
    if (!text) continue;
    const page = pages[slot.page];
    if (!page) continue;

    const fontSize = slot.fontSize && slot.fontSize > 0 ? slot.fontSize : 12;
    const color = parseAccent(slot.color);
    const safe = winAnsi(text);
    let size = Math.min(fontSize, Math.max(6, slot.height * 0.92));
    let width = font.widthOfTextAtSize(safe, size);
    // Encoger solo si no entra en el ancho (el alto ya limitó size).
    while (width > slot.width - 2 && size > 6) {
      size -= 0.5;
      width = font.widthOfTextAtSize(safe, size);
    }

    const align = slot.align ?? 'center';
    let x = slot.x;
    if (align === 'center') x = slot.x + (slot.width - width) / 2;
    else if (align === 'right') x = slot.x + slot.width - width - 1;

    // Centrar verticalmente en la caja (baseline ≈ 0.72 * size).
    const y = slot.y + (slot.height - size * 0.72) / 2;

    page.drawText(safe, {
      x: Math.max(0, x),
      y: Math.max(0, y),
      size,
      font,
      color,
    });
  }

  return doc.save();
}
