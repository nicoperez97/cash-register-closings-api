import { readFileSync } from 'fs';
import { extname } from 'path';
import { normalizeLogoUrl } from './drive-url';
import { resolveUploadPath } from './uploads';

const EMAIL_SAFE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif']);

function isUploadedLogoPath(raw?: string | null): boolean {
  const v = (raw ?? '').trim().replace(/\\/g, '/');
  return !!v && !/^https?:\/\//i.test(v) && v.startsWith('shops/');
}

function mimeFromLogoPath(relativePath: string): string {
  const ext = extname(relativePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
}

function isEmailSafeMime(contentType: string): boolean {
  const base = contentType.split(';')[0].trim().toLowerCase();
  return EMAIL_SAFE_MIME.has(base);
}

/** Sniff por magic bytes (Content-Type de CDNs a veces miente). */
function mimeFromMagic(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return 'image/gif';
  }
  return null;
}

export type EmailLogoAsset = {
  buffer: Buffer;
  contentType: string;
  /** Content-ID sin <>, p.ej. shop-logo@crc */
  cid: string;
};

export const EMAIL_LOGO_CID = 'shop-logo@crc';

/**
 * Comprueba que una URL https sirva JPEG/PNG/GIF (usable en Gmail).
 * Evita poner en el mail un link que después se vea roto (p.ej. API local
 * apuntando a PUBLIC_APP_ORIGIN de prod sin ese logo).
 */
export async function probeEmailSafeImageUrl(url: string): Promise<boolean> {
  const target = (url ?? '').trim();
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: { Accept: 'image/*,*/*;q=0.8' },
    });
    if (!upstream.ok) return false;
    const headerType = upstream.headers.get('content-type') || '';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) return false;
    const sniffed = mimeFromMagic(buffer);
    if (sniffed) return true;
    return isEmailSafeMime(headerType);
  } catch {
    return false;
  }
}

/**
 * Carga el logo en un formato usable en emails (JPEG/PNG/GIF).
 * WebP/SVG se omiten: muchos clientes muestran ícono roto.
 */
export async function loadEmailSafeShopLogo(
  logoUrlRaw?: string | null,
): Promise<EmailLogoAsset | null> {
  const raw = (logoUrlRaw ?? '').trim();
  if (!raw) return null;

  let buffer: Buffer | null = null;
  let contentType = 'image/jpeg';

  if (isUploadedLogoPath(raw)) {
    const abs = resolveUploadPath(raw);
    if (!abs) return null;
    try {
      buffer = readFileSync(abs);
      contentType = mimeFromLogoPath(raw);
    } catch {
      return null;
    }
  } else {
    const url = normalizeLogoUrl(raw) ?? raw;
    if (!/^https?:\/\//i.test(url)) return null;
    try {
      const upstream = await fetch(url, {
        redirect: 'follow',
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });
      if (!upstream.ok) return null;
      contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.toLowerCase().startsWith('image/')) return null;
      buffer = Buffer.from(await upstream.arrayBuffer());
    } catch {
      return null;
    }
  }

  if (!buffer?.length) return null;
  const sniffed = mimeFromMagic(buffer);
  if (sniffed) contentType = sniffed;
  if (!isEmailSafeMime(contentType)) return null;

  return {
    buffer,
    contentType: contentType.split(';')[0].trim().toLowerCase(),
    cid: EMAIL_LOGO_CID,
  };
}
