import { existsSync, readFileSync } from 'fs';
import { extname } from 'path';
import { normalizeLogoUrl } from './drive-url';
import { resolveUploadPath } from './uploads';

const LOGO_FILE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'] as const;

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

function readUploadedLogoWithFallback(
  relativePath: string,
): { buffer: Buffer; contentType: string } | null {
  const tryPath = (path: string): { buffer: Buffer; contentType: string } | null => {
    const abs = resolveUploadPath(path);
    if (!abs || !existsSync(abs)) return null;
    try {
      const buf = readFileSync(abs);
      if (!buf.length) return null;
      return { buffer: buf, contentType: mimeFromLogoPath(path) };
    } catch {
      return null;
    }
  };

  const direct = tryPath(relativePath);
  if (direct) return direct;

  const normalized = relativePath.trim().replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return null;
  const dir = normalized.slice(0, slash);
  const base = normalized.slice(slash + 1).replace(/\.[^.]+$/, '');
  if (!base) return null;
  for (const ext of LOGO_FILE_EXTS) {
    const candidate = `${dir}/${base}${ext}`;
    if (candidate === normalized) continue;
    const hit = tryPath(candidate);
    if (hit) return hit;
  }
  return null;
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
    // Preferir JPEG/PNG/GIF: un Accept amplio a veces recibe WebP de CDNs.
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: { Accept: 'image/jpeg,image/png,image/gif,image/*;q=0.05' },
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
    const resolved = readUploadedLogoWithFallback(raw);
    if (!resolved) return null;
    buffer = resolved.buffer;
    contentType = resolved.contentType;
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
