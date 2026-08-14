import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join, resolve } from 'path';

const DEFAULT_DIR = join(process.cwd(), 'uploads');

export function uploadsRoot(): string {
  const fromEnv = (process.env.UPLOADS_DIR || '').trim();
  return fromEnv ? resolve(fromEnv) : DEFAULT_DIR;
}

export function ensureUploadsDir(...parts: string[]): string {
  const dir = join(uploadsRoot(), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeExt(originalName: string | undefined, mime: string | undefined): string {
  const fromName = extname(originalName || '').toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  const m = (mime || '').toLowerCase();
  if (m === 'application/pdf') return '.pdf';
  if (m === 'image/jpeg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/gif') return '.gif';
  return '.bin';
}

/** Guarda buffer y devuelve path relativo al root de uploads (con /). */
export function saveUploadFile(opts: {
  relativeDir: string;
  basename: string;
  buffer: Buffer;
  originalName?: string;
  mime?: string;
}): { relativePath: string; absolutePath: string; fileName: string } {
  const ext = safeExt(opts.originalName, opts.mime);
  const fileName = `${opts.basename}${ext}`;
  const dir = ensureUploadsDir(...opts.relativeDir.split('/').filter(Boolean));
  // Limpia versiones previas con otra extensión
  for (const oldExt of ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bin']) {
    const old = join(dir, `${opts.basename}${oldExt}`);
    if (existsSync(old) && old !== join(dir, fileName)) {
      try {
        unlinkSync(old);
      } catch {
        // ignore
      }
    }
  }
  const absolutePath = join(dir, fileName);
  writeFileSync(absolutePath, opts.buffer);
  const relativePath = [...opts.relativeDir.split('/').filter(Boolean), fileName].join('/');
  return { relativePath, absolutePath, fileName };
}

export function resolveUploadPath(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const root = uploadsRoot();
  const abs = resolve(root, relativePath.replace(/\\/g, '/'));
  if (!abs.startsWith(root)) return null;
  if (!existsSync(abs)) return null;
  return abs;
}

export function deleteUploadIfExists(relativePath: string | null | undefined): void {
  const abs = resolveUploadPath(relativePath);
  if (!abs) {
    // Intenta borrar variantes por basename si el path relativo quedó desfasado
    return;
  }
  try {
    unlinkSync(abs);
  } catch {
    // ignore
  }
}

/** Borra la carpeta de archivos de un candidato. */
export function deleteCandidateUploads(shopId: string, candidateId: string): void {
  const root = uploadsRoot();
  const dir = resolve(root, 'candidates', shopId, candidateId);
  if (!dir.startsWith(root) || !existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Borra todos los archivos del pago (factura + comprobante) y la carpeta. */
export function deletePaymentUploads(shopId: string, paymentId: string): void {
  const root = uploadsRoot();
  const dir = resolve(root, 'payments', shopId, paymentId);
  if (!dir.startsWith(root) || !existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // fallback archivo por archivo
    try {
      for (const name of readdirSync(dir)) {
        try {
          unlinkSync(join(dir, name));
        } catch {
          // ignore
        }
      }
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
