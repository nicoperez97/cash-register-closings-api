import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShopMenu } from '../menu/menu-parse.util';
import { ParsedCv } from '../candidates/cv-ocr.parser';
import { ParsedInvoice } from '../payments/invoice-ocr.parser';

type InlinePart = { inlineData: { mimeType: string; data: string } };
type TextPart = { text: string };

export type GeminiFailReason = 'disabled' | 'quota' | 'error' | 'empty';

export type GeminiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: GeminiFailReason; message: string };

@Injectable()
export class GeminiDocumentService {
  private readonly logger = new Logger(GeminiDocumentService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('gemini.apiKey');
  }

  private model(): string {
    return this.config.get<string>('gemini.model') || 'gemini-3.6-flash';
  }

  private apiKey(): string {
    return this.config.get<string>('gemini.apiKey') || '';
  }

  private fail(reason: GeminiFailReason, message: string): GeminiResult<never> {
    return { ok: false, reason, message };
  }

  private isQuotaError(status: number, body: string): boolean {
    const t = body.toLowerCase();
    return (
      status === 429 ||
      t.includes('resource_exhausted') ||
      t.includes('quota') ||
      t.includes('rate limit') ||
      t.includes('rate_limit')
    );
  }

  private filePart(file: Express.Multer.File): InlinePart | TextPart | null {
    const buf = file?.buffer;
    if (!buf?.length) return null;
    const name = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (name.endsWith('.txt') || mime.startsWith('text/')) {
      return { text: buf.toString('utf8').slice(0, 60000) };
    }
    let mimeType = mime;
    if (!mimeType || mimeType === 'application/octet-stream') {
      if (name.endsWith('.pdf')) mimeType = 'application/pdf';
      else if (name.endsWith('.png')) mimeType = 'image/png';
      else if (/\.jpe?g$/.test(name)) mimeType = 'image/jpeg';
      else if (name.endsWith('.webp')) mimeType = 'image/webp';
      else mimeType = 'application/pdf';
    }
    if (
      mimeType !== 'application/pdf' &&
      !mimeType.startsWith('image/') &&
      mimeType !== 'application/x-pdf'
    ) {
      return { text: buf.toString('utf8').slice(0, 60000) };
    }
    return {
      inlineData: {
        mimeType: mimeType === 'application/x-pdf' ? 'application/pdf' : mimeType,
        data: buf.toString('base64'),
      },
    };
  }

  private async generateJson<T>(
    parts: Array<TextPart | InlinePart>,
    system: string,
    timeoutMs = 55_000,
  ): Promise<GeminiResult<T>> {
    const key = this.apiKey();
    if (!key) {
      return this.fail('disabled', 'Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const model = this.model();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.warn(`Gemini HTTP ${res.status}: ${errText.slice(0, 240)}`);
        if (this.isQuotaError(res.status, errText)) {
          return this.fail(
            'quota',
            'Se agotó la cuota diaria de Gemini. Se usó el parseo local.',
          );
        }
        if (res.status === 404 || /no longer available|not found/i.test(errText)) {
          return this.fail(
            'error',
            `El modelo Gemini configurado no está disponible. Probá GEMINI_MODEL=gemini-3.6-flash. Se usó el parseo local.`,
          );
        }
        return this.fail('error', 'Gemini no respondió bien. Se usó el parseo local.');
      }
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text.trim()) {
        return this.fail('empty', 'Gemini no devolvió datos. Se usó el parseo local.');
      }
      try {
        return { ok: true, data: JSON.parse(text) as T };
      } catch {
        return this.fail('empty', 'Gemini devolvió un JSON inválido. Se usó el parseo local.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Gemini falló: ${msg}`);
      if (/abort/i.test(msg)) {
        return this.fail('error', 'Gemini tardó demasiado. Se usó el parseo local.');
      }
      return this.fail('error', 'No se pudo contactar Gemini. Se usó el parseo local.');
    } finally {
      clearTimeout(timer);
    }
  }

  async parseMenu(
    file: Express.Multer.File,
  ): Promise<GeminiResult<{ menu: ShopMenu; rawText: string }>> {
    if (!this.isEnabled()) {
      return this.fail('disabled', 'Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const part = this.filePart(file);
    if (!part) return this.fail('empty', 'No se pudo leer el archivo para Gemini.');
    const system = `Sos un extractor de cartas de restaurante. Devolvé SOLO JSON con esta forma:
{"title":"string|null","note":"string|null","sections":[{"name":"string","items":[{"name":"string","description":"string|null","price":number|null,"priceLabel":"string|null"}]}]}
Reglas:
- Separá bien cada plato (nunca metas varios platos en description).
- Secciones con nombres legibles (ej. "La pasta", "Le pizze", "Dolci", "Aperitivi e birre").
- priceLabel con el precio tal cual si hay dos precios (panino/combo) usá "\$11.000 / \$13.500".
- price numérico en ARS sin puntos de miles (11500) o null.
- Ignorá pies legales y logos.
- Idioma de nombres: el del documento.`;
    const data = await this.generateJson<{
      title?: string | null;
      note?: string | null;
      sections?: Array<{
        name?: string;
        items?: Array<{
          name?: string;
          description?: string | null;
          price?: number | null;
          priceLabel?: string | null;
        }>;
      }>;
    }>(
      [
        {
          text: `Archivo: ${file.originalname || 'carta'}. Extraé la carta completa en JSON.`,
        },
        part,
      ],
      system,
    );
    if (!data.ok) return data;
    if (!Array.isArray(data.data.sections)) {
      return this.fail('empty', 'Gemini no devolvió secciones. Se usó el parseo local.');
    }
    const sections = data.data.sections
      .map((s) => ({
        name: String(s?.name ?? '').trim().slice(0, 60),
        items: (s?.items ?? [])
          .map((it) => ({
            name: String(it?.name ?? '').trim().slice(0, 120),
            description: String(it?.description ?? '').trim().slice(0, 400) || null,
            price:
              it?.price == null || !Number.isFinite(Number(it.price))
                ? null
                : Number(it.price),
            priceLabel: String(it?.priceLabel ?? '').trim().slice(0, 48) || null,
          }))
          .filter((it) => it.name),
      }))
      .filter((s) => s.name && s.items.length);
    if (!sections.length) {
      return this.fail('empty', 'Gemini no encontró ítems. Se usó el parseo local.');
    }
    const menu: ShopMenu = {
      title: String(data.data.title ?? '').trim().slice(0, 80) || null,
      note: String(data.data.note ?? '').trim().slice(0, 500) || null,
      sections,
    };
    const rawText = sections
      .flatMap((s) => [s.name, ...s.items.map((it) => `${it.name} ${it.priceLabel || it.price || ''}`)])
      .join('\n')
      .slice(0, 12000);
    return { ok: true, data: { menu, rawText } };
  }

  async parseCv(files: Express.Multer.File[]): Promise<GeminiResult<ParsedCv>> {
    if (!this.isEnabled()) {
      return this.fail('disabled', 'Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const parts: Array<TextPart | InlinePart> = [
      {
        text: 'Extraé los datos del CV. Si hay varias páginas, son de la misma persona.',
      },
    ];
    for (const f of files.slice(0, 6)) {
      const p = this.filePart(f);
      if (p) parts.push(p);
    }
    if (parts.length < 2) return this.fail('empty', 'No hay archivos para Gemini.');
    const system = `Extraé un CV. Devolvé SOLO JSON:
{"firstName":"","lastName":"","email":null,"phone":null,"documentId":null,"address":null,"city":null,"country":null,"birthDate":null,"nationality":null,"linkedIn":null,"website":null,"summary":null,"education":[{"institution":"","degree":"","year":""}],"experience":[{"company":"","role":"","period":"","description":""}],"skills":[""],"languages":[{"name":"","level":""}],"rawText":""}
birthDate ISO YYYY-MM-DD si se puede. rawText: resumen corto del texto leído.`;
    const data = await this.generateJson<ParsedCv>(parts, system);
    if (!data.ok) return data;
    const firstName = String(data.data.firstName ?? '').trim();
    const lastName = String(data.data.lastName ?? '').trim();
    if (!firstName && !lastName && !data.data.email) {
      return this.fail('empty', 'Gemini no extrajo datos del CV. Se usó el parseo local.');
    }
    return {
      ok: true,
      data: {
        firstName: firstName || 'Sin',
        lastName: lastName || 'nombre',
        email: data.data.email ?? null,
        phone: data.data.phone ?? null,
        documentId: data.data.documentId ?? null,
        address: data.data.address ?? null,
        city: data.data.city ?? null,
        country: data.data.country ?? null,
        birthDate: data.data.birthDate ?? null,
        nationality: data.data.nationality ?? null,
        linkedIn: data.data.linkedIn ?? null,
        website: data.data.website ?? null,
        summary: data.data.summary ?? null,
        education: Array.isArray(data.data.education) ? data.data.education : [],
        experience: Array.isArray(data.data.experience) ? data.data.experience : [],
        skills: Array.isArray(data.data.skills) ? data.data.skills.map(String) : [],
        languages: Array.isArray(data.data.languages) ? data.data.languages : [],
        rawText: String(data.data.rawText ?? '').slice(0, 20000),
      },
    };
  }

  async parseServiceRules(file: Express.Multer.File): Promise<
    GeminiResult<{
      categories: Array<{
        name: string;
        rules: Array<{ phase: 'PRE' | 'DURING' | 'POST'; title: string; body: string }>;
      }>;
    }>
  > {
    if (!this.isEnabled()) {
      return this.fail('disabled', 'Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const part = this.filePart(file);
    if (!part) return this.fail('empty', 'No se pudo leer el archivo para Gemini.');
    const system = `Sos un extractor de normas de servicio de un local gastronómico.
Devolvé SOLO JSON con esta forma:
{"categories":[{"name":"string","rules":[{"phase":"PRE"|"DURING"|"POST","title":"string","body":"string"}]}]}
Reglas:
- categories = sectores o áreas (Salón, Cocina, Bar, Caja, Baños, etc.).
- phase PRE = antes del servicio / apertura / mise en place.
- phase DURING = durante el servicio / en servicio / en el turno.
- phase POST = después / cierre / limpieza final.
- Si el documento habla de "antes" / "durante" / "después" / apertura / cierre, mapeá a PRE, DURING o POST.
- Si no queda claro, preferí PRE.
- title corto (acción); body el detalle completo. Si solo hay un renglón, repetilo en title y body.
- No inventes normas que no estén en el documento.
- Ignorá logos, pies legales y publicidad.
- Idioma: el del documento.`;
    const data = await this.generateJson<{
      categories?: Array<{
        name?: string;
        rules?: Array<{ phase?: string; title?: string; body?: string }>;
      }>;
    }>(
      [
        {
          text: `Archivo: ${file.originalname || 'normas'}. Extraé todas las normas de servicio en JSON.`,
        },
        part,
      ],
      system,
    );
    if (!data.ok) {
      if (data.reason === 'disabled') return data;
      return this.fail(
        data.reason,
        data.message.replace(/\s*Se usó el parseo local\.?/gi, '').trim() || data.message,
      );
    }
    if (!Array.isArray(data.data.categories)) {
      return this.fail('empty', 'Gemini no devolvió categorías de normas.');
    }
    const normalizePhase = (raw: string | undefined): 'PRE' | 'DURING' | 'POST' => {
      const t = String(raw ?? '')
        .trim()
        .toUpperCase();
      if (
        t === 'POST' ||
        t.includes('DESPU') ||
        t.includes('CIERRE') ||
        t.includes('AFTER')
      ) {
        return 'POST';
      }
      if (
        t === 'DURING' ||
        t.includes('DURANT') ||
        t.includes('DURING') ||
        t.includes('EN SERVICIO') ||
        t.includes('MID')
      ) {
        return 'DURING';
      }
      return 'PRE';
    };
    const categories = data.data.categories
      .map((c) => ({
        name: String(c?.name ?? '')
          .trim()
          .slice(0, 120),
        rules: (c?.rules ?? [])
          .map((r) => {
            const title = String(r?.title ?? '')
              .trim()
              .slice(0, 200);
            const body =
              String(r?.body ?? '')
                .trim()
                .slice(0, 8000) || title;
            return {
              phase: normalizePhase(r?.phase),
              title,
              body,
            };
          })
          .filter((r) => r.title && r.body),
      }))
      .filter((c) => c.name && c.rules.length);
    if (!categories.length) {
      return this.fail('empty', 'Gemini no encontró normas en el archivo.');
    }
    return { ok: true, data: { categories } };
  }

  async parseInvoice(file: Express.Multer.File): Promise<GeminiResult<ParsedInvoice>> {
    if (!this.isEnabled()) {
      return this.fail('disabled', 'Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const part = this.filePart(file);
    if (!part) return this.fail('empty', 'No se pudo leer el archivo para Gemini.');
    const system = `Extraé datos de una factura argentina. Devolvé SOLO JSON:
{"legalName":null,"taxId":null,"invoiceType":null,"invoiceNumber":null,"netAmount":null,"ivaAmount":null,"perceptionsAmount":null,"otherTaxesAmount":null,"totalAmount":null,"rawText":""}
taxId = CUIT (XX-XXXXXXXX-X). invoiceType = A/B/C/etc. Montos numéricos con decimales.`;
    const data = await this.generateJson<ParsedInvoice>(
      [{ text: `Archivo: ${file.originalname || 'factura'}` }, part],
      system,
    );
    if (!data.ok) return data;
    if (!data.data.taxId && data.data.totalAmount == null && !data.data.invoiceNumber) {
      return this.fail('empty', 'Gemini no extrajo la factura. Se usó el parseo local.');
    }
    return {
      ok: true,
      data: {
        legalName: data.data.legalName ?? null,
        taxId: data.data.taxId ?? null,
        invoiceType: data.data.invoiceType ?? null,
        invoiceNumber: data.data.invoiceNumber ?? null,
        netAmount: data.data.netAmount ?? null,
        ivaAmount: data.data.ivaAmount ?? null,
        perceptionsAmount: data.data.perceptionsAmount ?? null,
        otherTaxesAmount: data.data.otherTaxesAmount ?? null,
        totalAmount: data.data.totalAmount ?? null,
        rawText: String(data.data.rawText ?? '').slice(0, 12000),
      },
    };
  }

  async analyzeLedgerImport(digest: unknown): Promise<
    GeminiResult<{
      summary: string;
      findings: string[];
      accounts: Array<{ name: string; note: string }>;
      warnings: string[];
    }>
  > {
    if (!this.isEnabled()) {
      return this.fail('disabled', 'Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const system = `Sos un analista del libro diario de un local gastronómico (Uruguay/Argentina).
Te pasan un resumen numérico de un Excel de movimientos (cuenta emisora, receptora, importe).
El saldo de cada cuenta operativa es lo que entra menos lo que sale.
Las cuentas 1. Ingreso / 2. Egreso son origen y destino del libro, no cajas.
Devolvé SOLO JSON:
{"summary":"string","findings":["string"],"accounts":[{"name":"string","note":"string"}],"warnings":["string"]}
Reglas:
- Español rioplatense, frases cortas, segunda persona, sin jerga.
- summary: 2 a 4 oraciones. Decí si los números cierran y por qué una cuenta grande (p. ej. PVS) queda negativa o positiva.
- findings: hasta 6 viñetas concretas, con montos si ayudan.
- accounts: solo las cuentas que merecen una nota (máx 6).
- warnings: rarezas (cuenta nueva, desbalance raro, PVS usado para gastos y divisiones a socios). Vacío si no hay.
- No inventes filas. Usá solo el resumen.
- No sugieras cambiar la fórmula del saldo.`;
    const data = await this.generateJson<{
      summary?: string;
      findings?: unknown;
      accounts?: unknown;
      warnings?: unknown;
    }>(
      [
        {
          text: `Resumen del Excel a importar:\n${JSON.stringify(digest).slice(0, 14000)}`,
        },
      ],
      system,
      22_000,
    );
    if (!data.ok) {
      return this.fail(
        data.reason,
        data.message
          .replace(/\s*Se usó el parseo local\.?/gi, '')
          .trim() || data.message,
      );
    }
    const strList = (raw: unknown, max: number): string[] =>
      (Array.isArray(raw) ? raw : [])
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, max);
    const accounts = (Array.isArray(data.data.accounts) ? data.data.accounts : [])
      .map((a) => {
        const row = a as { name?: string; note?: string };
        return {
          name: String(row?.name ?? '').trim().slice(0, 80),
          note: String(row?.note ?? '').trim().slice(0, 280),
        };
      })
      .filter((a) => a.name && a.note)
      .slice(0, 6);
    const summary = String(data.data.summary ?? '').trim().slice(0, 900);
    if (!summary) {
      return this.fail('empty', 'Gemini no devolvió un análisis del Excel.');
    }
    return {
      ok: true,
      data: {
        summary,
        findings: strList(data.data.findings, 6),
        accounts,
        warnings: strList(data.data.warnings, 4),
      },
    };
  }
}
