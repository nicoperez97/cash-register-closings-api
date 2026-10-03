import { existsSync } from 'fs';
import { join } from 'path';
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import type { PublicPagePwaKind } from './public-page-pwa';
import { publicPagePwaKindMeta } from './public-page-pwa';

export const PUBLIC_PAGE_PWA_ICON_SIZES = [180, 192, 512] as const;
export type PublicPagePwaIconSize = (typeof PUBLIC_PAGE_PWA_ICON_SIZES)[number];

const BADGE_FONT_FAMILY = 'PwaBadgeSans';
let badgeFontReady: boolean | null = null;

export function parsePublicPagePwaIconSize(raw: string): PublicPagePwaIconSize | null {
  const n = Number(String(raw ?? '').replace(/\.png$/i, '').trim());
  if ((PUBLIC_PAGE_PWA_ICON_SIZES as readonly number[]).includes(n)) {
    return n as PublicPagePwaIconSize;
  }
  return null;
}

/**
 * Ícono PWA: logo del local (o fondo accent) + inicial de la página encima (badge).
 */
export async function renderPublicPagePwaIcon(opts: {
  kind: PublicPagePwaKind;
  size: PublicPagePwaIconSize;
  accentColor?: string | null;
  logo?: { buffer: Buffer; contentType: string } | null;
}): Promise<Buffer> {
  const meta = publicPagePwaKindMeta(opts.kind);
  const size = opts.size;
  const accent = normalizeHex(opts.accentColor) || meta.defaultTheme;
  const letter = meta.iconLetter;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Fondo
  ctx.fillStyle = accent;
  roundRect(ctx, 0, 0, size, size, size * 0.18);
  ctx.fill();

  if (opts.logo?.buffer?.length) {
    try {
      const img = await loadImage(opts.logo.buffer);
      const pad = size * 0.12;
      const box = size - pad * 2;
      const scale = Math.min(box / img.width, box / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (size - w) / 2;
      const y = (size - h) / 2 - size * 0.04;
      // Disco claro detrás del logo para contraste
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2 - size * 0.04, box * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2 - size * 0.04, box * 0.46, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    } catch {
      // Sin logo usable → solo letra grande abajo
      drawCenteredLetter(ctx, letter, size, accent);
      return canvas.toBuffer('image/png');
    }
  } else {
    drawCenteredLetter(ctx, letter, size, accent);
    return canvas.toBuffer('image/png');
  }

  // Badge con inicial (esquina inferior derecha)
  const badgeR = size * 0.22;
  const cx = size - badgeR - size * 0.08;
  const cy = size - badgeR - size * 0.08;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.arc(cx + size * 0.012, cy + size * 0.012, badgeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(2, size * 0.018);
  ctx.stroke();

  drawGlyphLetter(ctx, letter, cx, cy + size * 0.01, Math.round(badgeR * 1.15));

  return canvas.toBuffer('image/png');
}

function ensureBadgeFont(): boolean {
  if (badgeFontReady != null) return badgeFontReady;
  const candidates = [
    join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
    join(process.cwd(), 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ];
  for (const fontPath of candidates) {
    if (!existsSync(fontPath)) continue;
    try {
      GlobalFonts.registerFromPath(fontPath, BADGE_FONT_FAMILY);
      badgeFontReady = true;
      return true;
    } catch {
      // probar siguiente
    }
  }
  badgeFontReady = false;
  return false;
}

function fontSpec(px: number): string {
  if (ensureBadgeFont()) {
    return `700 ${px}px "${BADGE_FONT_FAMILY}"`;
  }
  return `700 ${px}px sans-serif`;
}

/** Dibuja la letra con fuente embebida; si no hay glifo, trazo vectorial. */
function drawGlyphLetter(
  ctx: SKRSContext2D,
  letter: string,
  cx: number,
  cy: number,
  px: number,
): void {
  const L = String(letter || '?').slice(0, 1).toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.font = fontSpec(px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(L).width;
  if (width > 1) {
    ctx.fillText(L, cx, cy);
    return;
  }
  drawVectorLetter(ctx, L, cx, cy, px);
}

function drawVectorLetter(
  ctx: SKRSContext2D,
  letter: string,
  cx: number,
  cy: number,
  px: number,
): void {
  const stroke = Math.max(2, px * 0.18);
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = px * 0.36;

  if (letter === 'C') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, (-210 * Math.PI) / 180, (30 * Math.PI) / 180, false);
    ctx.stroke();
    return;
  }

  if (letter === 'O') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  // Fallback genérico: barra vertical + tope (se lee como “I”/marca)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}

function drawCenteredLetter(
  ctx: SKRSContext2D,
  letter: string,
  size: number,
  accent: string,
): void {
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
  ctx.fill();
  drawGlyphLetter(ctx, letter, size / 2, size / 2 + size * 0.02, Math.round(size * 0.48));
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function normalizeHex(raw?: string | null): string | null {
  const m = String(raw || '')
    .trim()
    .replace(/^#/, '')
    .match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toLowerCase()}`;
}
