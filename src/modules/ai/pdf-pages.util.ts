import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import * as path from 'path';
import { pathToFileURL } from 'url';

function ensureDomPolyfills() {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
  if (!g.ImageData) g.ImageData = ImageData;
  if (!g.Path2D) g.Path2D = Path2D;
}

/**
 * Rasteriza las primeras páginas de un PDF a PNG (para proveedores sin PDF nativo).
 */
export async function renderPdfPagesToPng(
  buffer: Buffer,
  maxPages = 3,
  scale = 1.5,
): Promise<Buffer[]> {
  if (!buffer?.length) return [];
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

  const n = Math.min(Math.max(0, doc.numPages), Math.max(0, maxPages));
  const out: Buffer[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    out.push(canvas.toBuffer('image/png'));
  }
  return out;
}
