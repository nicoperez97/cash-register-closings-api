import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { ServiceRulePhase } from '../../common/enums';

type PdfCategory = { id: string; name: string; sortOrder: number };
type PdfRule = {
  categoryId: string;
  phase: ServiceRulePhase | string;
  title: string;
  body: string;
  sortOrder: number;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

function parseAccent(hex?: string | null) {
  const m = String(hex || '')
    .trim()
    .match(/^#?([0-9a-f]{6})$/i);
  if (!m) return rgb(0.18, 0.49, 0.2);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function winAnsi(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\u0009\u000a\u0020-\u007e\u00a0-\u00ff]/g, ' ');
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of winAnsi(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = '';
      for (const ch of word) {
        const trial = chunk + ch;
        if (font.widthOfTextAtSize(trial, size) <= maxWidth) chunk = trial;
        else {
          if (chunk) out.push(chunk);
          chunk = ch;
        }
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

export async function buildServiceRulesPdf(opts: {
  shopName: string;
  accentColor?: string | null;
  categories: PdfCategory[];
  rules: PdfRule[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const accent = parseAccent(opts.accentColor);
  const ink = rgb(0.11, 0.08, 0.06);
  const muted = rgb(0.38, 0.32, 0.26);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensure = (need: number) => {
    if (y - need >= MARGIN) return;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const drawLines = (
    lines: string[],
    used: PDFFont,
    size: number,
    color: ReturnType<typeof rgb>,
    leading: number,
  ) => {
    for (const line of lines) {
      ensure(leading);
      if (line) {
        page.drawText(line, { x: MARGIN, y: y - size, size, font: used, color });
      }
      y -= leading;
    }
  };

  drawLines(['NORMAS DE SERVICIO'], fontBold, 10, accent, 14);
  drawLines(wrapLines(opts.shopName, fontBold, 22, CONTENT_W), fontBold, 22, ink, 26);
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 2.5,
    color: accent,
  });
  y -= 22;

  const phases: Array<{ value: ServiceRulePhase; label: string }> = [
    { value: ServiceRulePhase.PRE, label: 'Antes del servicio' },
    { value: ServiceRulePhase.POST, label: 'Después del servicio' },
  ];
  const cats = [...opts.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'),
  );

  for (const phase of phases) {
    const groups = cats
      .map((category) => ({
        category,
        rules: opts.rules
          .filter((r) => r.categoryId === category.id && r.phase === phase.value)
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'es')),
      }))
      .filter((g) => g.rules.length);
    if (!groups.length) continue;

    ensure(28);
    drawLines([phase.label], fontBold, 16, accent, 22);
    y -= 4;

    for (const g of groups) {
      ensure(24);
      drawLines(wrapLines(g.category.name, fontBold, 13, CONTENT_W), fontBold, 13, ink, 18);
      page.drawLine({
        start: { x: MARGIN, y: y + 8 },
        end: { x: PAGE_W - MARGIN, y: y + 8 },
        thickness: 0.6,
        color: rgb(0.9, 0.86, 0.78),
      });
      y -= 6;

      for (const rule of g.rules) {
        drawLines(wrapLines(rule.title, fontBold, 12, CONTENT_W), fontBold, 12, ink, 16);
        drawLines(wrapLines(rule.body, font, 11, CONTENT_W), font, 11, muted, 15);
        y -= 8;
      }
      y -= 6;
    }
  }

  return doc.save();
}
