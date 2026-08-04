import { BadRequestException } from '@nestjs/common';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { recognize } from 'tesseract.js';
import {
  CandidateEducationItem,
  CandidateExperienceItem,
  CandidateLanguageItem,
} from '../../entities/candidate.entity';

export type ParsedCv = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  documentId: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  birthDate: string | null;
  nationality: string | null;
  linkedIn: string | null;
  website: string | null;
  summary: string | null;
  education: CandidateEducationItem[];
  experience: CandidateExperienceItem[];
  skills: string[];
  languages: CandidateLanguageItem[];
  rawText: string;
};

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
  if (buf?.length >= 4 && buf.subarray(0, 4).toString('utf8') === '%PDF') return true;
  return false;
}

function isImage(file: Express.Multer.File): boolean {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = (file.originalname || '').toLowerCase();
  return /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name);
}

function clean(s: string | null | undefined): string | null {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v || null;
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function ocrPdfFirstPage(buffer: Buffer): Promise<string> {
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

  if (!doc.numPages) {
    throw new BadRequestException('El PDF no tiene páginas');
  }

  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    canvas: canvas as unknown as HTMLCanvasElement,
  }).promise;

  const png = canvas.toBuffer('image/png');
  const result = await recognize(png, 'spa');
  return result.data.text || '';
}

async function ocrImage(buffer: Buffer): Promise<string> {
  const result = await recognize(buffer, 'spa');
  return result.data.text || '';
}

function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (m) return m[0].toLowerCase();
  // OCR suele romper el @ o el dominio
  const loose = text.match(
    /([A-Z0-9._%+-]{4,40})\s*[@©]\s*([A-Z0-9.-]{3,30})\s*[.]\s*(com|net|org|ar|uy)/i,
  );
  if (loose) return `${loose[1]}@${loose[2]}.${loose[3]}`.toLowerCase().replace(/\s/g, '');
  return null;
}

function extractPhone(text: string): string | null {
  const labeled = text.match(
    /(?:cel(?:ular)?|tel(?:[eé]fono)?|whatsapp|phone)\s*[:.]?\s*([+\d(][\d\s()./-]{7,})/i,
  );
  if (labeled) {
    const raw = labeled[1].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) return clean(raw);
  }
  const patterns = [
    /\(\d{2,4}\)\s*\d{3,4}[\s.-]?\d{3,4}/g,
    /\b\d{2,4}[\s.-]\d{3,4}[\s.-]?\d{3,4}\b/g,
    /\b\d{10,11}\b/g,
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const raw = m[0].trim();
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15 && !/^(19|20)\d{2}$/.test(digits)) {
        return clean(raw);
      }
    }
  }
  return null;
}

function extractDocumentId(text: string): string | null {
  const m = text.match(
    /(?:\b(?:DNI|CI|C\.?I\.?|documento|cedula|cédula|pasaporte)\b)\s*[:.]?\s*([A-Z0-9.\-\s]{5,20})/i,
  );
  if (m) return clean(m[1].replace(/\s+/g, ''));
  return null;
}

function extractLinkedIn(text: string): string | null {
  const m = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)?]+/i);
  if (m) return m[0].replace(/[.,;]+$/, '');
  const handle = text.match(/linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
  return handle ? `https://www.${handle[0]}` : null;
}

function extractWebsite(text: string, linkedIn: string | null): string | null {
  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/gi)].map((m) =>
    m[0].replace(/[.,;]+$/, ''),
  );
  for (const u of urls) {
    if (/linkedin\.com/i.test(u)) continue;
    if (linkedIn && u.toLowerCase().includes('linkedin.com')) continue;
    return u;
  }
  const bare = text.match(
    /(?:web|website|sitio|www)\s*[:.]?\s*((?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}[^\s]*)/i,
  );
  if (bare) {
    const u = bare[1].replace(/[.,;]+$/, '');
    if (!/linkedin\.com/i.test(u) && !/@/.test(u)) {
      return /^https?:\/\//i.test(u) ? u : `https://${u}`;
    }
  }
  const domain = text.match(/\b((?:www\.)?[a-z0-9-]+\.(?:com|net|org|ar|uy|io))\b/i);
  if (domain && !/@/.test(domain[0]) && !/gmail|hotmail|yahoo|outlook/i.test(domain[0])) {
    return `https://${domain[1]}`;
  }
  return null;
}

const MONTHS: Record<string, string> = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
  ene: '01',
  feb: '02',
  mar: '03',
  abr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dic: '12',
};

function extractBirthDate(text: string): string | null {
  const labeledNum = text.match(
    /(?:fecha\s+de\s+nacimiento|nacimiento|born|birthday)\s*[:.]?\s*(\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4})/i,
  );
  if (labeledNum) return normalizeDate(labeledNum[1]);

  const labeledEs = text.match(
    /(?:fecha\s+de\s+nacimiento|nacimiento)\s*[:.]?\s*(\d{1,2})\s*(?:de\s+)?([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s*(?:de(?:l)?\s+)?(\d{4})/i,
  );
  if (labeledEs) {
    const day = labeledEs[1].padStart(2, '0');
    const key = stripAccents(labeledEs[2]).toLowerCase();
    const mon = MONTHS[key] ?? MONTHS[key.slice(0, 3)];
    if (mon) return `${labeledEs[3]}-${mon}-${day}`;
  }
  return null;
}

function normalizeDate(raw: string): string | null {
  const parts = raw.trim().split(/[\/\-.\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
  if (d.length === 1) d = `0${d}`;
  if (m.length === 1) m = `0${m}`;
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null;
  return `${y}-${m}-${d}`;
}

function extractNationality(text: string): string | null {
  const m = text.match(/(?:nacionalidad|nationality)\s*[:.]?\s*([A-Za-zÁÉÍÓÚáéíóúÑñ\s]{3,40})/i);
  return m ? clean(m[1].split(/\n/)[0]) : null;
}

function labeledValue(text: string, labels: string[]): string | null {
  const alt = labels.map((l) => l.replace(/\s+/g, '\\s+')).join('|');
  const re = new RegExp(`(?:${alt})\\s*[:.]\\s*([^\\n]{2,120})`, 'i');
  const m = text.match(re);
  return m ? clean(m[1]) : null;
}

function headerRegex(matched: string): RegExp {
  return new RegExp(
    matched
      .replace(/A/gi, '[AÁá]')
      .replace(/E/gi, '[EÉé]')
      .replace(/I/gi, '[IÍí]')
      .replace(/O/gi, '[OÓó]')
      .replace(/U/gi, '[UÚú]')
      .replace(/\s+/g, '\\s+'),
    'i',
  );
}

function isPlausibleSectionHeader(rawLine: string, key: string, normIndex: number): boolean {
  if (normIndex === 0) return true;
  const rm = rawLine.match(headerRegex(key));
  if (!rm || rm.index == null) return normIndex === 0;
  const idx = rm.index;
  const slice = rm[0];
  if (slice === slice.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(slice)) return true;
  const before = rawLine.slice(0, idx);
  if (/\b(CONTACTO|PERFIL|EXPERIENCIA|EDUCACI[OÓ]N|HABILIDADES|IDIOMAS|FORMACI[OÓ]N|ESTUDIOS)\s*$/i.test(before)) {
    return true;
  }
  // Evitar "habilidades que me ayuden…" (minúsculas a mitad de frase)
  if (/[a-záéíóúñ]/.test(slice) && idx > 0) return false;
  return false;
}

/** Extrae el cuerpo de una sección por palabras clave (robusto a OCR de 2 columnas). */
function sectionBody(text: string, keys: string[]): string | null {
  const lines = text.split(/\r?\n/);
  const norm = (s: string) => stripAccents(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const keysN = keys.map((k) => stripAccents(k).toUpperCase()).sort((a, b) => b.length - a.length);
  const allKeysN = [
    'EXPERIENCIA LABORAL',
    'EXPERIENCIA PROFESIONAL',
    'EXPERIENCIA RELEVANTE',
    'EXPERIENCIA',
    'EDUCACION Y FORMACION',
    'FORMACION ACADEMICA',
    'EDUCACION',
    'FORMACION',
    'ESTUDIOS',
    'HABILIDADES Y COMPETENCIAS',
    'COMPETENCIAS TECNICAS',
    'COMPETENCIAS PROFESIONALES',
    'HABILIDADES',
    'COMPETENCIAS',
    'CONOCIMIENTOS Y APTITUDES',
    'CONOCIMIENTOS',
    'APTITUDES',
    'SKILLS',
    'IDIOMAS',
    'IDIOMA',
    'PERFIL PROFESIONAL',
    'RESUMEN PROFESIONAL',
    'CARTA DE PRESENTACION',
    'PERFIL',
    'RESUMEN',
    'OBJETIVO',
    'CONTACTO',
    'DATOS PERSONALES',
    'CURSOS Y CAPACITACIONES',
    'CURSOS',
    'DISPONIBILIDAD HORARIA',
    'DISPONIBILIDAD',
    'REFERENCIAS',
  ].sort((a, b) => b.length - a.length);

  let start = -1;
  let sameLineTail = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = norm(raw);
    if (!line) continue;

    let foundKey: string | null = null;
    let foundAt = -1;
    for (const key of keysN) {
      const idx = line.indexOf(key);
      if (idx < 0) continue;
      // Evitar match parcial: "EXPERIENCIA" dentro de algo más largo ya cubierto por keys ordenadas
      const beforeOk = idx === 0 || /\s$/.test(line.slice(0, idx)) || /[^\w]$/.test(line.slice(0, idx));
      const after = line.slice(idx + key.length);
      const afterOk = !after || /^\s/.test(after) || /^[^\w]/.test(after);
      if (!beforeOk || !afterOk) continue;
      if (!isPlausibleSectionHeader(raw, key, idx)) continue;
      foundKey = key;
      foundAt = idx;
      break;
    }
    if (!foundKey) continue;

    const rm = raw.match(headerRegex(foundKey));
    const cut = rm?.index ?? -1;
    sameLineTail =
      cut >= 0 && rm
        ? raw.slice(cut + rm[0].length).replace(/^[\s\[\]|:.-]+/, '').trim()
        : '';
    start = i + 1;
    break;
  }

  if (start < 0) return null;

  const body: string[] = [];
  if (sameLineTail) body.push(sameLineTail);

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) {
      body.push('');
      continue;
    }
    const line = norm(raw);

    let stopAt = -1;
    let stopKey: string | null = null;
    for (const key of allKeysN) {
      if (keysN.includes(key)) continue;
      const idx = line.indexOf(key);
      if (idx < 0) continue;
      const beforeOk = idx === 0 || /\s$/.test(line.slice(0, idx));
      if (!beforeOk) continue;
      if (!isPlausibleSectionHeader(raw, key, idx)) continue;
      stopAt = idx;
      stopKey = key;
      break;
    }

    if (stopAt === 0) break;
    if (stopAt > 0) {
      const rm = raw.match(headerRegex(stopKey!));
      const cut = rm?.index ?? stopAt;
      if (cut > 0) body.push(raw.slice(0, cut).trim());
      break;
    }
    body.push(raw);
  }

  return body.join('\n').trim() || null;
}

function mergeSections(...bodies: Array<string | null>): string | null {
  const parts = bodies.filter((b): b is string => !!b?.trim());
  return parts.length ? parts.join('\n') : null;
}

function titleCaseWords(words: string[]): string {
  return words
    .map((w) => {
      const lower = w.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function looksLikePersonName(words: string[]): boolean {
  if (words.length < 2 || words.length > 5) return false;
  if (
    !words.every(
      (w) =>
        /^(de|del|la|los|las|y)$/i.test(w) || /^[A-Za-zÁÉÍÓÚáéíóúÑñ'.-]{3,30}$/.test(w),
    )
  ) {
    return false;
  }
  const joined = stripAccents(words.join(' ')).toLowerCase();
  if (
    /\b(involucro|trabajo|resoluci|problema|ambiente|aprender|habilidad|empanada|preparaci|cocina|reposicion|atencion|publico|manejo|caja|responsable|comprometido|activo|camino|profesional|soy|donde|tienen|nueva|tapas|armado|limpieza|supervision|personal|materia|prima|sushi|empleado|cocinero|jefe|ayudante|excel|powerpoint|word|proactividad|puntualidad|nativo|intermedio|basico|tecnico|quimico|gastronomico|educacion|experiencia|contacto|perfil)\b/.test(
      joined,
    )
  ) {
    return false;
  }
  if (/\b(en la|con el|de mi|de las|al publico)\b/.test(joined)) return false;
  return true;
}

function nameFromWords(words: string[]): { firstName: string; lastName: string } {
  const titled = titleCaseWords(words).split(' ');
  if (titled.length >= 3) {
    return { firstName: titled.slice(0, 2).join(' '), lastName: titled.slice(2).join(' ') };
  }
  return { firstName: titled[0], lastName: titled.slice(1).join(' ') };
}

function parseName(text: string, email: string | null): { firstName: string; lastName: string } {
  const labeledComma = text.match(
    /(?:apellido\s*y\s*nombres?|apellidos?\s*y\s*nombres?|nombre\s*completo)\s*[:.]\s*([A-Za-zÁÉÍÓÚáéíóúÑñ' .-]+),\s*([A-Za-zÁÉÍÓÚáéíóúÑñ' .-]+)/i,
  );
  if (labeledComma) {
    const last = labeledComma[1].trim().split(/\s+/);
    const first = labeledComma[2].trim().split(/\s+/);
    if (looksLikePersonName([...first, ...last])) {
      return {
        lastName: titleCaseWords(last),
        firstName: titleCaseWords(first),
      };
    }
  }

  // LinkedIn / Unkedin (OCR) suele traer el nombre completo
  const liName = text.match(
    /(?:linkedin|unkedin|linked\s*in)\s*[:.]?\s*([A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ']*(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñ']+){1,4})/i,
  );
  if (liName) {
    let words = liName[1].trim().split(/\s+/).filter(Boolean);
    const after = text.slice(liName.index! + liName[0].length, liName.index! + liName[0].length + 60);
    const nextWord = after.match(/^\s*(?:[-–—]\s*[^\n]*)?\n?\s*([A-Za-zÁÉÍÓÚáéíóúÑñ']{3,20})\b/);
    if (
      nextWord &&
      words.length < 5 &&
      !/manejo|caja|reposicion|atencion|empleado|cocinero/i.test(nextWord[1]) &&
      looksLikePersonName([...words, nextWord[1]])
    ) {
      words = [...words, nextWord[1]];
    }
    if (looksLikePersonName(words)) return nameFromWords(words);
  }

  const labeledPlain = text.match(
    /(?:apellido\s*y\s*nombres?|nombre\s*completo|nombre\s*y\s*apellido)\s*[:.]\s*([A-Za-zÁÉÍÓÚáéíóúÑñ' .-]{5,80})/i,
  );
  if (labeledPlain) {
    const words = labeledPlain[1].trim().split(/\s+/).filter(Boolean);
    if (looksLikePersonName(words)) return nameFromWords(words);
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 60);

  const skip =
    /^(curriculum|curr[ií]culo|cv\b|resume|perfil|objetivo|contacto|datos|experiencia|educaci|formaci[oó]n|habilidad|competenc|idioma|email|tel|celular|correo|dni|ci\b|primaria|secundaria|universitario|puesto|estudios|estudiante|proactivo|informaci[oó]n|disponibilidad|referencias|soy\b)/i;

  const scored = lines.slice(0, 30)
    .map((line, idx) => {
      if (skip.test(line)) return null;
      if (/@/.test(line) || /https?:/i.test(line) || /linkedin|unkedin/i.test(line)) return null;
      if (/\d{4,}/.test(line)) return null;
      const comma = line.match(/^([A-Za-zÁÉÍÓÚáéíóúÑñ' .-]+),\s*([A-Za-zÁÉÍÓÚáéíóúÑñ' .-]+)$/);
      if (comma) {
        const last = comma[1].trim().split(/\s+/);
        const first = comma[2].trim().split(/\s+/);
        if (!looksLikePersonName([...first, ...last])) return null;
        return {
          firstName: titleCaseWords(first),
          lastName: titleCaseWords(last),
          score: 200 - idx,
        };
      }
      const words = line.replace(/[,|•·]/g, ' ').split(/\s+/).filter(Boolean);
      if (!looksLikePersonName(words)) return null;
      const allCaps = words.every((w) => w === w.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(w));
      const titleish = /^[A-ZÁÉÍÓÚÑ]/.test(words[0]);
      // Preferir nombres cortos (2-3 palabras) cerca del tope
      const score =
        (allCaps ? 80 : 0) +
        (titleish ? 25 : 0) +
        (words.length <= 3 ? 20 : 0) +
        (idx < 8 ? 30 : 0) +
        (20 - idx);
      const n = nameFromWords(words);
      return { ...n, score };
    })
    .filter(Boolean) as Array<{ firstName: string; lastName: string; score: number }>;

  scored.sort((a, b) => b.score - a.score);
  if (scored[0] && scored[0].score >= 40) {
    return { firstName: scored[0].firstName, lastName: scored[0].lastName };
  }

  if (email) {
    const local = email.split('@')[0].replace(/\d+/g, ' ').replace(/[._-]+/g, ' ');
    const parts = local.split(/\s+/).filter((p) => p.length >= 3);
    if (parts.length >= 2 && looksLikePersonName(parts.slice(0, 4))) {
      return nameFromWords(parts.slice(0, 4));
    }
  }

  return { firstName: '', lastName: '' };
}

function periodFrom(text: string): string | null {
  const m = text.match(
    /\b((?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\.?\s+(?:19|20)\d{2}|(?:19|20)\d{2})\s*[-–—\/a]\s*((?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\.?\s+(?:19|20)\d{2}|(?:19|20)\d{2}|actual(?:idad)?|presente|hoy|en\s+curso)\b/i,
  );
  return m ? clean(m[0]) : null;
}

function mineEducationFromText(text: string): CandidateEducationItem[] {
  const items: CandidateEducationItem[] = [];
  const seen = new Set<string>();
  const patterns: Array<{ re: RegExp; degree: string; institution?: string }> = [
    { re: /t[eé]cnico\s+qu[ií]mico/i, degree: 'Técnico Químico', institution: 'E.P.E.T.S' },
    {
      re: /t[eé]cnico\s+superior\s+gastronom/i,
      degree: 'Técnico Superior Gastronómico',
      institution: 'Cocineros Patagónicos',
    },
    { re: /cocineros\s+patag[oó]nicos/i, degree: 'Técnico Superior Gastronómico', institution: 'Cocineros Patagónicos' },
  ];
  for (const p of patterns) {
    if (!p.re.test(text)) continue;
    const key = stripAccents(`${p.degree}|${p.institution ?? ''}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ degree: p.degree, institution: p.institution });
  }
  // Período cerca de EP.ETS / educación
  const periodNear =
    text.match(
      /(?:E\.?P\.?E?\.?T\.?S?|t[eé]cnico\s+qu[ií]mico)[^\n]{0,60}?((?:19|20)\d{2}\s*[-–—\/]\s*(?:(?:19|20)\d{2}|actual(?:idad)?))/i,
    ) ||
    text.match(/((?:19|20)\d{2}\s*[-–—\/]\s*(?:19|20)\d{2}).{0,60}(?:cocineros\s+patag|t[eé]cnico\s+superior)/i) ||
    text.match(/(?:idiomas|educaci[oó]n)\s+((?:19|20)\d{2}\s*[-–—\/]\s*(?:19|20)\d{2})/i);
  if (periodNear) {
    const p = clean(periodNear[1]) ?? undefined;
    for (const it of items) {
      if (!it.period && /qu[ií]mico|gastronom/i.test(it.degree ?? '')) it.period = p;
    }
  }
  return items;
}

function mergeEducation(
  primary: CandidateEducationItem[],
  mined: CandidateEducationItem[],
): CandidateEducationItem[] {
  const out = [...primary];
  const keyOf = (e: CandidateEducationItem) =>
    stripAccents(`${e.degree ?? ''}|${e.institution ?? ''}`).toLowerCase().replace(/\s+/g, ' ');
  const keys = new Set(out.map(keyOf));
  for (const m of mined) {
    const existing = out.find((e) => {
      const ed = stripAccents(e.degree ?? '').toLowerCase();
      const md = stripAccents(m.degree ?? '').toLowerCase();
      if (md && ed && (ed.includes(md.slice(0, 12)) || md.includes(ed.slice(0, 12)))) return true;
      const ei = stripAccents(e.institution ?? '').toLowerCase();
      const mi = stripAccents(m.institution ?? '').toLowerCase();
      return !!(mi && ei && (ei.includes(mi.slice(0, 10)) || mi.includes(ei.slice(0, 10))));
    });
    if (existing) {
      if (!existing.period && m.period) existing.period = m.period;
      if (!existing.institution && m.institution) existing.institution = m.institution;
      if (!existing.degree && m.degree) existing.degree = m.degree;
      continue;
    }
    const k = keyOf(m);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(m);
  }
  return out
    .filter((e) => {
      const d = stripAccents(e.degree ?? '').toLowerCase().replace(/\s+/g, '');
      if (
        /^e\.?p\.?e?\.?t/.test(d) &&
        out.some((o) => /qu[ií]mico/i.test(o.degree ?? ''))
      ) {
        return false;
      }
      return !!(e.degree || e.institution);
    })
    .slice(0, 12);
}

function parseEducation(body: string | null, fullText?: string): CandidateEducationItem[] {
  const items: CandidateEducationItem[] = [];
  const source = body ?? '';

  const labeled = [
    ...source.matchAll(
      /(?:primaria|secundaria|universitario|universidad|terciario|t[ií]tulo\s+secundario|licenciatura|profesorado|ingenier[ií]a|t[eé]cnico)\s*[:.-]\s*([^\n]+)/gi,
    ),
  ];
  if (labeled.length) {
    for (const m of labeled.slice(0, 12)) {
      const level = m[0].split(/[:.-]/)[0].trim();
      items.push({
        degree: clean(level) ?? undefined,
        institution: clean(m[1]) ?? undefined,
        period: periodFrom(m[1]) ?? undefined,
      });
    }
  }

  if (!items.length && source) {
    const lines = source
      .split(/\n/)
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);

    let current: CandidateEducationItem | null = null;
    const flush = () => {
      if (current && (current.institution || current.degree)) items.push(current);
      current = null;
    };

    for (const line of lines) {
      if (/^(promedio|participaci|proyecto|titulo secundario completo|logro)/i.test(line)) {
        if (current) {
          current.degree = current.degree
            ? `${current.degree}; ${line}`.slice(0, 200)
            : line;
        }
        continue;
      }
      const looksDegree =
        /^(licenciatura|profesorado|t[eé]cnico|ingenier[ií]a|bachiller|curso|estudiante)/i.test(
          line,
        ) || /universidad|facultad|colegio|escuela|e\.?p\.?e\.?t|unlp|secundari/i.test(line);
      if (looksDegree || periodFrom(line)) {
        flush();
        current = {
          degree: clean(line) ?? undefined,
          period: periodFrom(line) ?? undefined,
        };
        continue;
      }
      if (current && !current.institution) {
        current.institution = clean(line) ?? undefined;
      } else if (current) {
        current.degree = `${current.degree ?? ''} ${line}`.trim().slice(0, 200);
      }
    }
    flush();
  }

  return mergeEducation(items, fullText ? mineEducationFromText(fullText) : []);
}

const COMPANY_HINT =
  /\b((?:Autoservicio\s+La\s+Huerta|West\s*Food(?:\s*[-–—]\s*Distrito\s+Oeste)?|Atu\s*sushi|Batacaz(?:\s+o?\s*Empanadas)?|Restaurante[^,\n]{0,40}|Kiosco[^,\n]{0,40}|Ferreter[ií]a[^,\n]{0,40}|Helader[ií]a[^,\n]{0,40}|Panader[ií]a[^,\n]{0,40}))/i;

const ROLE_HINT =
  /^(atenci[oó]n al cliente|ayudante(?:\s+de\s+cocina)?|cajero|barman|cocinero|jefe(?:\s+de\s+cocina)?|encargado|repartidor|empleado|bachero|ventas|gesti[oó]n|emprendedora?)\b/i;

function normalizeCompanyKey(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mineExperienceFromText(text: string): CandidateExperienceItem[] {
  const items: CandidateExperienceItem[] = [];
  const seen = new Set<string>();
  const roleNear = (from: number, companyLen: number): string | undefined => {
    const after = text.slice(from + companyLen, from + companyLen + 120);
    const before = text.slice(Math.max(0, from - 30), from);
    const afterRole = after.match(
      /^\s*[-–—,:]?\s*(empleado|cocinero|ayudante(?:\s+de\s+cocina)?|jefe(?:\s+de\s+cocina)?|cajero|encargado)\b/i,
    );
    if (afterRole) return clean(afterRole[1]) ?? undefined;
    for (const l of after.split(/\n/).slice(0, 3)) {
      const trimmed = l.trim();
      if (!trimmed) continue;
      if (COMPANY_HINT.test(trimmed)) break;
      const m = trimmed.match(
        /\b(empleado|cocinero|ayudante(?:\s+de\s+cocina)?|jefe(?:\s+de\s+cocina)?|cajero|encargado)\b/i,
      );
      if (m) return clean(m[1]) ?? undefined;
    }
    const beforeRole = before.match(
      /\b(empleado|cocinero|ayudante(?:\s+de\s+cocina)?|jefe(?:\s+de\s+cocina)?|cajero|encargado)\s*$/i,
    );
    return beforeRole ? clean(beforeRole[1]) ?? undefined : undefined;
  };

  for (const m of text.matchAll(new RegExp(COMPANY_HINT.source, 'gi'))) {
    const company = clean(m[1].replace(/\s+/g, ' ')) ?? undefined;
    if (!company) continue;
    const key = normalizeCompanyKey(company).slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      company,
      role: roleNear(m.index ?? 0, m[0].length),
    });
  }
  return items;
}

function mergeExperience(
  primary: CandidateExperienceItem[],
  mined: CandidateExperienceItem[],
): CandidateExperienceItem[] {
  const out = [...primary];
  // Unir rol huérfano con empresa anterior
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].role && !out[i].company && out[i - 1].company && !out[i - 1].role) {
      out[i - 1].role = out[i].role;
      if (out[i].description && !out[i - 1].description) out[i - 1].description = out[i].description;
      out.splice(i, 1);
    }
  }
  const keys = new Set(
    out.map((e) => normalizeCompanyKey(e.company ?? e.role ?? '').slice(0, 24)).filter(Boolean),
  );
  for (const m of mined) {
    const key = normalizeCompanyKey(m.company ?? '').slice(0, 24);
    if (!key) continue;
    const existing = out.find((e) => normalizeCompanyKey(e.company ?? '').startsWith(key.slice(0, 12)) || key.startsWith(normalizeCompanyKey(e.company ?? '').slice(0, 12)));
    if (existing) {
      if (!existing.role && m.role) existing.role = m.role;
      continue;
    }
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(m);
  }
  return out.slice(0, 20);
}

function scrubExperienceNoise(line: string): string | null {
  let s = line
    .replace(/\[?E?\s*U?nkedin\s*[:.]?\s*[A-Za-zÁÉÍÓÚáéíóúÑñ' .-]{0,60}/gi, '')
    .replace(/\b\d{8,15}\b/g, '')
    .replace(/\bNe\b/gi, '')
    .replace(/^[«»•*+\-\s]+/, '')
    .trim();
  if (!s || isOcrNoise(s)) return null;
  if (/linkedin|unkedin|julio|gabriel|p[aá]ez|mart[ií]nez/i.test(s) && s.length < 50) return null;
  return clean(s);
}

function parseExperience(body: string | null, fullText?: string): CandidateExperienceItem[] {
  const items: CandidateExperienceItem[] = [];
  const lines = (body ?? '')
    .split(/\n/)
    .map((l) => l.replace(/^[•\-*«»]\s*/, '').trim())
    .filter(Boolean);

  let current: CandidateExperienceItem | null = null;
  const flush = () => {
    if (current && (current.company || current.role || current.description)) items.push(current);
    current = null;
  };

  for (const line of lines) {
    const puesto = line.match(/^(?:puesto|cargo|rol)\s*[:.-]\s*(.+)$/i);
    if (puesto && current) {
      current.role = clean(puesto[1]) ?? undefined;
      continue;
    }

    const yearLead = line.match(
      /^((?:19|20)\d{2}\s*[-–—\/]\s*(?:(?:19|20)\d{2}|actual(?:idad)?|presente))\s*[:.-]\s*(.+)$/i,
    );
    if (yearLead) {
      flush();
      current = {
        period: clean(yearLead[1]) ?? undefined,
        role: clean(yearLead[2]) ?? undefined,
        description: clean(yearLead[2]) ?? undefined,
      };
      continue;
    }

    const companyInline = line.match(COMPANY_HINT);
    const isCompany =
      !!companyInline ||
      /^(restaurante|bar|caf[eé]|empresa|local|hotel|pub|kiosco|ferreter[ií]a|helader[ií]a|panader[ií]a|autoservicio|emprendimiento|west\s*food|atu\s*sushi|batacaz)\b/i.test(
        line,
      ) ||
      /\((?:andorra|argentina|uruguay|espa[nñ]a|chile|neuqu[eé]n|la plata)[^)]*\)/i.test(line) ||
      /\b(la huerta|distrito oeste|empanadas)\b/i.test(line);

    const hasPeriod = !!periodFrom(line);
    const isRoleTitle = ROLE_HINT.test(line) && line.length < 80;

    if ((isCompany || (hasPeriod && line.length < 100) || isRoleTitle) && !/^puesto\s*:/i.test(line)) {
      if (
        current &&
        hasPeriod &&
        /^[\w.\s]{0,20}\d{4}/.test(line) &&
        line.length < 40 &&
        !current.period
      ) {
        current.period = periodFrom(line) ?? undefined;
        continue;
      }
      if (current?.role && !current.company && isCompany) {
        current.company = clean(line) ?? undefined;
        const p = periodFrom(line);
        if (p) current.period = p;
        continue;
      }
      // Rol después de empresa sin rol
      if (isRoleTitle && !companyInline && current?.company && !current.role) {
        current.role = clean(line) ?? undefined;
        continue;
      }
      if (isRoleTitle && !companyInline && items.length && !current) {
        const prev = items[items.length - 1];
        if (prev.company && !prev.role) {
          prev.role = clean(line) ?? undefined;
          continue;
        }
      }
      flush();
      const period = periodFrom(line);
      const companyName = companyInline
        ? clean(companyInline[1]) ?? undefined
        : isRoleTitle
          ? undefined
          : clean(line) ?? undefined;
      if (isRoleTitle && !companyInline) {
        current = { role: clean(line) ?? undefined, period: period ?? undefined };
      } else {
        current = {
          company: companyName,
          period: period ?? undefined,
          role: isRoleTitle && companyInline ? clean(line) ?? undefined : undefined,
        };
      }
      continue;
    }

    if (current) {
      if (
        current.role &&
        !current.company &&
        line.length < 80 &&
        !/manejo|soporte|preparaci|atenci[oó]n|coordinaci|reposici|limpieza|armado|elaboraci/i.test(line)
      ) {
        current.company = clean(line) ?? undefined;
        const p = periodFrom(line);
        if (p) current.period = p;
        continue;
      }
      if (!current.period) {
        const p = periodFrom(line);
        if (p && line.length < 50) {
          current.period = p;
          continue;
        }
      }
      if (
        current.company &&
        !current.role &&
        line.length < 60 &&
        ROLE_HINT.test(line)
      ) {
        current.role = clean(line) ?? undefined;
        continue;
      }
      if (/@/.test(line) || /https?:/i.test(line) || /^[\d\s().+-]{8,}$/.test(line)) {
        continue;
      }
      const scrubbed = scrubExperienceNoise(line);
      if (!scrubbed) continue;
      const prev = current.description ? `${current.description} ` : '';
      current.description = clean((prev + scrubbed).slice(0, 800)) ?? undefined;
    }
  }
  flush();
  return mergeExperience(items, fullText ? mineExperienceFromText(fullText) : []);
}

function parseSkills(body: string | null, fullText?: string): string[] {
  const knownOffice =
    /\b(excel|powerpoint|word|canva|outlook|teams|google\s*sheets)\b/gi;
  const knownSoft =
    /^(proactividad|puntualidad|organizaci[oó]n|atenci[oó]n al cliente|aprendizaje r[aá]pido|trabajo en equipo|comunicaci[oó]n|resoluci[oó]n de problemas|control de stock|manipulaci[oó]n de alimentos|responsabilidad|compromiso)$/i;

  const found: string[] = [];
  const add = (s: string) => {
    const c = clean(s);
    if (!c) return;
    const key = stripAccents(c).toLowerCase();
    if (found.some((x) => stripAccents(x).toLowerCase() === key)) return;
    found.push(c);
  };

  const source = `${body ?? ''}\n${fullText ?? ''}`;
  for (const m of source.matchAll(knownOffice)) {
    add(m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase());
  }

  const parts = (body ?? '')
    .replace(/\n/g, ',')
    .split(/[,;|•·]/)
    .map((s) => s.replace(/^[-–—YvV+*]\s*/, '').trim())
    .filter((s) => {
      if (s.length < 2 || s.length > 40) return false;
      if (isOcrNoise(s)) return false;
      if (/^referencias?/i.test(s)) return false;
      if (/\d{3,}/.test(s)) return false;
      if (/\b(que me|al p[uú]blico|del carro|de cocina|materia prima|supervisi[oó]n|atu sushi|westfood|manejo de caja)\b/i.test(s)) {
        return false;
      }
      if (knownSoft.test(s)) return true;
      if (/^(excel|powerpoint|word|canva)$/i.test(s)) return true;
      return false;
    });
  for (const p of parts) add(p);
  return found.slice(0, 40);
}

const KNOWN_LANGUAGES: Array<{ keys: string[]; label: string }> = [
  { keys: ['espanol', 'español', 'castellano', 'spanish'], label: 'Español' },
  { keys: ['ingles', 'inglés', 'english'], label: 'Inglés' },
  { keys: ['frances', 'francés', 'french'], label: 'Francés' },
  { keys: ['portugues', 'portugués', 'portuguese'], label: 'Portugués' },
  { keys: ['italiano', 'italian'], label: 'Italiano' },
  { keys: ['aleman', 'alemán', 'german', 'deutsch'], label: 'Alemán' },
  { keys: ['chino', 'chinese', 'mandarin', 'mandarín'], label: 'Chino' },
  { keys: ['japones', 'japonés', 'japanese'], label: 'Japonés' },
];

const LANG_LEVELS =
  /\b(nativo|nativa|biling[uü]e|avanzado|avanzada|intermedio|intermedia|basico|básico|basica|básica|fluido|fluida|a1|a2|b1|b2|c1|c2)\b/i;

function matchKnownLanguage(token: string): string | null {
  const key = stripAccents(token).toLowerCase().replace(/[^a-z]/g, '');
  if (key.length < 4) return null;
  for (const lang of KNOWN_LANGUAGES) {
    if (lang.keys.some((k) => key === stripAccents(k).replace(/[^a-z]/g, '') || key.startsWith(stripAccents(k).replace(/[^a-z]/g, '')))) {
      return lang.label;
    }
  }
  return null;
}

function isOcrNoise(line: string): boolean {
  const s = line.trim();
  if (!s || s.length < 2) return true;
  if (/^[\d\s/\\|_\-=+*~.^<>[\]{}()]+$/.test(s)) return true;
  const letters = (s.match(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/g) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  const symbols = (s.match(/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s:.\-()/]/g) || []).length;
  if (letters < 3) return true;
  if (digits > letters) return true;
  if (symbols > letters / 2) return true;
  // "v A Y", "7727", "/ UTE AA"
  if (/^[vVyY\sA-Z0-9/\\|_\-]{1,12}$/.test(s) && !matchKnownLanguage(s)) return true;
  if (/t[eé]cnico|gastronom|cocinero|patagon|quimico|educaci|experiencia/i.test(s)) return true;
  return false;
}

function cleanLangLevel(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(LANG_LEVELS);
  if (m) {
    const w = m[1];
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase().replace('basico', 'básico').replace('basica', 'básica');
  }
  const cleaned = clean(raw.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s+\-]/g, ' ')) ?? '';
  if (cleaned.length < 2 || cleaned.length > 40 || isOcrNoise(cleaned)) return undefined;
  if (/\d{3,}/.test(cleaned) || /tecnico|cocineros|patagon/i.test(cleaned)) return undefined;
  return cleaned;
}

function parseLanguages(_body: string | null, fullText?: string): CandidateLanguageItem[] {
  const source = fullText ?? _body ?? '';
  const found = new Map<string, string | undefined>();

  // "Inglés: Intermedio", "Y Francés: Básico", "Español: Nativo"
  for (const m of source.matchAll(
    /(?:^|[\n\s•\-YvV])\s*([A-Za-zÁÉÍÓÚáéíóúÑñ]{4,20})\s*[:.\-–—]\s*([^\n,]{2,40})/gim,
  )) {
    const label = matchKnownLanguage(m[1]);
    if (!label) continue;
    const level = cleanLangLevel(m[2]);
    if (!found.has(label) || level) found.set(label, level ?? found.get(label));
  }

  // "Idioma Inglés" + niveles
  for (const m of source.matchAll(/idioma\s+([A-Za-zÁÉÍÓÚáéíóúÑñ]{4,20})/gi)) {
    const label = matchKnownLanguage(m[1]);
    if (label && !found.has(label)) found.set(label, undefined);
  }

  // Lista suelta solo si el token es idioma conocido
  for (const line of source.split(/\n/)) {
    if (isOcrNoise(line)) continue;
    const token = line.replace(/^[-•*YvV]\s*/, '').trim().split(/[:.\-–—]/)[0];
    const label = matchKnownLanguage(token);
    if (label && !found.has(label)) found.set(label, undefined);
  }

  return [...found.entries()].map(([name, level]) => ({ name, level }));
}

function parseAddressBits(text: string): {
  address: string | null;
  city: string | null;
  country: string | null;
} {
  const addr = labeledValue(text, ['direcci[oó]n', 'address', 'domicilio', 'calle']);
  const city =
    labeledValue(text, ['ciudad', 'city', 'localidad', 'lugar']) ??
    labeledValue(text, ['provincia']);
  const locLine = text.match(
    /\b((?:Gran\s+)?La\s+Plata|Neuqu[eé]n(?:\s+Capital)?|Buenos\s+Aires|Monte\s+Grande)[^\n,]*/i,
  );
  const country =
    labeledValue(text, ['pa[ií]s', 'country']) ??
    (/\bArgentina\b/i.test(text) ? 'Argentina' : null) ??
    (/\bUruguay\b/i.test(text) ? 'Uruguay' : null);

  return {
    address: addr,
    city: city || (locLine ? clean(locLine[1]) : null),
    country,
  };
}

export function parseCvText(rawText: string): ParsedCv {
  const text = (rawText || '').replace(/\u0000/g, '').trim();
  const email = extractEmail(text);
  const phone = extractPhone(text);
  const documentId = extractDocumentId(text);
  const linkedIn = extractLinkedIn(text);
  const website = extractWebsite(text, linkedIn);
  const birthDate = extractBirthDate(text);
  const nationality = extractNationality(text);
  const { firstName, lastName } = parseName(text, email);
  const { address, city, country } = parseAddressBits(text);

  const summary = mergeSections(
    sectionBody(text, ['PERFIL PROFESIONAL', 'PERFIL', 'RESUMEN PROFESIONAL', 'RESUMEN', 'OBJETIVO', 'ABOUT ME', 'SUMMARY', 'PROFILE']),
    sectionBody(text, ['CARTA DE PRESENTACION']),
  );

  const education = parseEducation(
    mergeSections(
      sectionBody(text, [
        'EDUCACION Y FORMACION',
        'FORMACION ACADEMICA',
        'EDUCACION',
        'FORMACION',
        'ESTUDIOS',
        'EDUCATION',
      ]),
      sectionBody(text, ['CURSOS Y CAPACITACIONES', 'CURSOS']),
    ),
    text,
  );
  const experience = parseExperience(
    sectionBody(text, [
      'EXPERIENCIA LABORAL',
      'EXPERIENCIA PROFESIONAL',
      'EXPERIENCIA RELEVANTE',
      'EXPERIENCIA',
      'WORK EXPERIENCE',
      'TRABAJO',
      'EMPLEO',
    ]),
    text,
  );
  const skills = parseSkills(
    sectionBody(text, [
      'HABILIDADES Y COMPETENCIAS',
      'COMPETENCIAS TECNICAS',
      'COMPETENCIAS PROFESIONALES',
      'CONOCIMIENTOS Y APTITUDES',
      'HABILIDADES',
      'COMPETENCIAS',
      'CONOCIMIENTOS',
      'APTITUDES',
      'SKILLS',
    ]),
    text,
  );
  const languages = parseLanguages(sectionBody(text, ['IDIOMAS', 'IDIOMA', 'LANGUAGES']), text);

  const disponibilidad = sectionBody(text, ['DISPONIBILIDAD HORARIA', 'DISPONIBILIDAD']);
  const summaryFinal = [summary, disponibilidad ? `Disponibilidad: ${disponibilidad}` : null]
    .filter(Boolean)
    .join('\n\n');

  return {
    firstName,
    lastName,
    email,
    phone,
    documentId,
    address,
    city,
    country,
    birthDate,
    nationality,
    linkedIn,
    website,
    summary: clean(summaryFinal)?.slice(0, 2500) ?? null,
    education,
    experience,
    skills,
    languages,
    rawText: text,
  };
}

async function ocrOneFile(file: Express.Multer.File): Promise<string> {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Archivo vacío');
  }
  if (!isPdf(file) && !isImage(file)) {
    throw new BadRequestException(
      `El archivo "${file.originalname || 'sin nombre'}" debe ser imagen (JPG/PNG/WebP) o PDF`,
    );
  }
  try {
    return isPdf(file) ? await ocrPdfFirstPage(file.buffer) : await ocrImage(file.buffer);
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException(
      `No se pudo leer el texto de "${file.originalname || 'archivo'}"`,
    );
  }
}

/** OCR de una o varias imágenes/PDF (misma persona) y parseo heurístico. */
export async function ocrAndParseCv(
  files: Express.Multer.File | Express.Multer.File[],
): Promise<ParsedCv> {
  const list = (Array.isArray(files) ? files : [files]).filter((f) => !!f?.buffer?.length);
  if (!list.length) {
    throw new BadRequestException('Archivo requerido');
  }
  if (list.length > 10) {
    throw new BadRequestException('Máximo 10 archivos por CV');
  }

  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const pageText = (await ocrOneFile(list[i])).trim();
    if (pageText) {
      parts.push(list.length > 1 ? `--- Página ${i + 1} ---\n${pageText}` : pageText);
    }
  }

  const rawText = parts.join('\n\n').trim();
  if (!rawText) {
    throw new BadRequestException('No se detectó texto en la(s) imagen(es)/PDF');
  }

  return parseCvText(rawText);
}

/** Solo para tests locales del parser. */
export const __cvParseTest = {
  sectionBody,
  parseExperience,
  parseEducation,
  parseSkills,
  parseName,
};
