import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { PublicPagePwaKind } from './public-page-pwa';
import { publicPagePwaKindMeta } from './public-page-pwa';

export const PUBLIC_PAGE_PWA_ICON_SIZES = [180, 192, 512] as const;
export type PublicPagePwaIconSize = (typeof PUBLIC_PAGE_PWA_ICON_SIZES)[number];

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
  const cx = size - badgeR - size * 0.06;
  const cy = size - badgeR - size * 0.06;
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

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(badgeR * 1.15)}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, cx, cy + size * 0.01);

  return canvas.toBuffer('image/png');
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
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(size * 0.48)}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2 + size * 0.02);
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
