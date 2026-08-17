import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShopMenu } from '../menu/menu-parse.util';
import { ParsedCv } from '../candidates/cv-ocr.parser';
import { ParsedInvoice } from '../payments/invoice-ocr.parser';

type InlinePart = { inlineData: { mimeType: string; data: string } };
type TextPart = { text: string };

@Injectable()
export class GeminiDocumentService {
  private readonly logger = new Logger(GeminiDocumentService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('gemini.apiKey');
  }

  private model(): string {
    return this.config.get<string>('gemini.model') || 'gemini-2.0-flash';
  }

  private apiKey(): string {
    return this.config.get<string>('gemini.apiKey') || '';
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
    // Gemini free: PDF + common images
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
  ): Promise<T | null> {
    const key = this.apiKey();
    if (!key) return null;
    const model = this.model();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
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
        return null;
      }
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text.trim()) return null;
      return JSON.parse(text) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Gemini falló: ${msg}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async parseMenu(file: Express.Multer.File): Promise<{ menu: ShopMenu; rawText: string } | null> {
    const part = this.filePart(file);
    if (!part) return null;
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
    if (!data || !Array.isArray(data.sections)) return null;
    const sections = data.sections
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
    if (!sections.length) return null;
    const menu: ShopMenu = {
      title: String(data.title ?? '').trim().slice(0, 80) || null,
      note: String(data.note ?? '').trim().slice(0, 500) || null,
      sections,
    };
    const rawText = sections
      .flatMap((s) => [s.name, ...s.items.map((it) => `${it.name} ${it.priceLabel || it.price || ''}`)])
      .join('\n')
      .slice(0, 12000);
    return { menu, rawText };
  }

  async parseCv(files: Express.Multer.File[]): Promise<ParsedCv | null> {
    const parts: Array<TextPart | InlinePart> = [
      {
        text: 'Extraé los datos del CV. Si hay varias páginas, son de la misma persona.',
      },
    ];
    for (const f of files.slice(0, 6)) {
      const p = this.filePart(f);
      if (p) parts.push(p);
    }
    if (parts.length < 2) return null;
    const system = `Extraé un CV. Devolvé SOLO JSON:
{"firstName":"","lastName":"","email":null,"phone":null,"documentId":null,"address":null,"city":null,"country":null,"birthDate":null,"nationality":null,"linkedIn":null,"website":null,"summary":null,"education":[{"institution":"","degree":"","year":""}],"experience":[{"company":"","role":"","period":"","description":""}],"skills":[""],"languages":[{"name":"","level":""}],"rawText":""}
birthDate ISO YYYY-MM-DD si se puede. rawText: resumen corto del texto leído.`;
    const data = await this.generateJson<ParsedCv>(parts, system);
    if (!data) return null;
    const firstName = String(data.firstName ?? '').trim();
    const lastName = String(data.lastName ?? '').trim();
    if (!firstName && !lastName && !data.email) return null;
    return {
      firstName: firstName || 'Sin',
      lastName: lastName || 'nombre',
      email: data.email ?? null,
      phone: data.phone ?? null,
      documentId: data.documentId ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      birthDate: data.birthDate ?? null,
      nationality: data.nationality ?? null,
      linkedIn: data.linkedIn ?? null,
      website: data.website ?? null,
      summary: data.summary ?? null,
      education: Array.isArray(data.education) ? data.education : [],
      experience: Array.isArray(data.experience) ? data.experience : [],
      skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
      languages: Array.isArray(data.languages) ? data.languages : [],
      rawText: String(data.rawText ?? '').slice(0, 20000),
    };
  }

  async parseInvoice(file: Express.Multer.File): Promise<ParsedInvoice | null> {
    const part = this.filePart(file);
    if (!part) return null;
    const system = `Extraé datos de una factura argentina. Devolvé SOLO JSON:
{"legalName":null,"taxId":null,"invoiceType":null,"invoiceNumber":null,"netAmount":null,"ivaAmount":null,"perceptionsAmount":null,"otherTaxesAmount":null,"totalAmount":null,"rawText":""}
taxId = CUIT (XX-XXXXXXXX-X). invoiceType = A/B/C/etc. Montos numéricos con decimales.`;
    const data = await this.generateJson<ParsedInvoice>(
      [{ text: `Archivo: ${file.originalname || 'factura'}` }, part],
      system,
    );
    if (!data) return null;
    if (!data.taxId && data.totalAmount == null && !data.invoiceNumber) return null;
    return {
      legalName: data.legalName ?? null,
      taxId: data.taxId ?? null,
      invoiceType: data.invoiceType ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      netAmount: data.netAmount ?? null,
      ivaAmount: data.ivaAmount ?? null,
      perceptionsAmount: data.perceptionsAmount ?? null,
      otherTaxesAmount: data.otherTaxesAmount ?? null,
      totalAmount: data.totalAmount ?? null,
      rawText: String(data.rawText ?? '').slice(0, 12000),
    };
  }
}
