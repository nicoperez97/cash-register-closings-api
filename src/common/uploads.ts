import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join, resolve } from 'path';
import { DOCUMENT_UPLOAD_FOLDERS } from './upload-retention';

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

/** Borra los archivos de un cierre (cuentas canales / caja sistema) y la carpeta. */
export function deleteClosingUploads(shopId: string, closingId: string): void {
  const root = uploadsRoot();
  const dir = resolve(root, 'closings', shopId, closingId);
  if (!dir.startsWith(root) || !existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
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

/** Fecha de subida: la más vieja entre nacimiento y mtime del archivo. */
export function uploadFileTime(relativePath: string | null | undefined): Date | null {
  const abs = resolveUploadPath(relativePath);
  if (!abs) return null;
  try {
    const st = statSync(abs);
    const times = [st.mtime.getTime()];
    const born = st.birthtime?.getTime() ?? 0;
    if (born > 0 && born < Date.now() + 60_000) times.push(born);
    return new Date(Math.min(...times));
  } catch {
    return null;
  }
}

function listFilesRecursive(dir: string, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (!abs.startsWith(root)) continue;
    if (entry.isDirectory()) listFilesRecursive(abs, root, out);
    else if (entry.isFile()) out.push(abs);
  }
}

function removeEmptyDirs(dir: string, root: string): void {
  if (!existsSync(dir) || !dir.startsWith(root) || dir === root) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) removeEmptyDirs(join(dir, entry.name), root);
  }
  try {
    if (readdirSync(dir).length === 0 && dir !== root) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

/** Borra documentos vencidos en disco. No toca logos, avatares ni cartas. */
export function purgeExpiredDocumentUploads(cutoff: Date): number {
  const root = uploadsRoot();
  let removed = 0;
  for (const folder of DOCUMENT_UPLOAD_FOLDERS) {
    const base = resolve(root, folder);
    if (!base.startsWith(root) || !existsSync(base)) continue;
    const files: string[] = [];
    listFilesRecursive(base, root, files);
    for (const abs of files) {
      try {
        const st = statSync(abs);
        const times = [st.mtime.getTime()];
        const born = st.birthtime?.getTime() ?? 0;
        if (born > 0 && born < Date.now() + 60_000) times.push(born);
        if (Math.min(...times) < cutoff.getTime()) {
          unlinkSync(abs);
          removed += 1;
        }
      } catch {
        // ignore
      }
    }
    removeEmptyDirs(base, root);
  }
  return removed;
}
