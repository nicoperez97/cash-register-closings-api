import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderPdfPagesToPng } from './pdf-pages.util';

export type GroqFailReason = 'disabled' | 'quota' | 'error' | 'empty';

export type GroqResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: GroqFailReason; message: string };

type TextPart = { text: string };
type InlinePart = { inlineData: { mimeType: string; data: string } };

type GroqContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const MAX_IMAGES = 3;

@Injectable()
export class GroqDocumentService {
  private readonly logger = new Logger(GroqDocumentService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.apiKey();
  }

  private apiKey(): string {
    return this.config.get<string>('groq.apiKey') || '';
  }

  private model(): string {
    return this.config.get<string>('groq.model') || 'qwen/qwen3.8-27b';
  }

  private fail(reason: GroqFailReason, message: string): GroqResult<never> {
    return { ok: false, reason, message };
  }

  private isQuotaError(status: number, body: string): boolean {
    const t = body.toLowerCase();
    return (
      status === 429 ||
      t.includes('rate_limit') ||
      t.includes('rate limit') ||
      t.includes('quota') ||
      t.includes('tokens per day') ||
      t.includes('requests per day')
    );
  }

  private isTransientError(status: number, body: string): boolean {
    if (status === 503 || status === 500 || status === 408 || status === 429) return true;
    const t = body.toLowerCase();
    return t.includes('overloaded') || t.includes('try again') || t.includes('unavailable');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async partsToContent(
    parts: Array<TextPart | InlinePart>,
  ): Promise<GroqContentPart[]> {
    const out: GroqContentPart[] = [];
    let images = 0;
    for (const part of parts) {
      if ('text' in part && part.text != null) {
        out.push({ type: 'text', text: String(part.text) });
        continue;
      }
      if (!('inlineData' in part) || !part.inlineData?.data) continue;
      const mime = (part.inlineData.mimeType || '').toLowerCase();
      const raw = part.inlineData.data;
      if (mime === 'application/pdf' || mime === 'application/x-pdf') {
        try {
          const pages = await renderPdfPagesToPng(Buffer.from(raw, 'base64'), MAX_IMAGES - images);
          for (const png of pages) {
            if (images >= MAX_IMAGES) break;
            out.push({
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
            });
            images++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Groq PDF→PNG falló: ${msg.slice(0, 200)}`);
        }
        continue;
      }
      if (mime.startsWith('image/') && images < MAX_IMAGES) {
        out.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${raw}` },
        });
        images++;
      }
    }
    return out;
  }

  async generateJson<T>(
    parts: Array<TextPart | InlinePart>,
    system: string,
    timeoutMs = 55_000,
  ): Promise<GroqResult<T>> {
    const key = this.apiKey();
    if (!key) {
      return this.fail('disabled', 'Groq no está configurado (falta GROQ_API_KEY).');
    }

    const content = await this.partsToContent(parts);
    if (!content.length) {
      return this.fail('empty', 'No se pudo preparar el archivo para Groq.');
    }

    const model = this.model();
    const maxAttempts = 2;
    let lastKind: GroqFailReason | 'transient' = 'error';
    let lastDetail = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.generateJsonOnce<T>(
        model,
        key,
        system,
        content,
        Math.min(timeoutMs, Math.max(12_000, timeoutMs - (attempt - 1) * 8_000)),
      );
      if (res.ok) {
        if (attempt > 1) this.logger.log(`Groq OK con ${model} (intento ${attempt})`);
        return { ok: true, data: res.data };
      }
      lastKind = res.kind;
      lastDetail = res.detail;
      if (res.kind === 'quota') {
        return this.fail(
          'quota',
          'Se agotó la cuota de Groq. Se usó el parseo local.',
        );
      }
      if (res.kind === 'empty' || res.kind === 'error') break;
      if (attempt < maxAttempts) {
        const delay = Math.min(4_000, 600 * attempt + Math.floor(Math.random() * 300));
        this.logger.warn(`Groq ocupado (${model}), reintento ${attempt + 1} en ${delay}ms`);
        await this.sleep(delay);
      }
    }

    if (lastKind === 'empty') {
      return this.fail('empty', 'Groq no devolvió datos. Se usó el parseo local.');
    }
    this.logger.warn(`Groq falló (${model}): ${lastDetail.slice(0, 200)}`);
    return this.fail('error', 'Groq no pudo responder. Se usó el parseo local.');
  }

  private async generateJsonOnce<T>(
    model: string,
    key: string,
    system: string,
    content: GroqContentPart[],
    timeoutMs: number,
  ): Promise<
    | { ok: true; data: T }
    | { ok: false; kind: GroqFailReason | 'transient'; detail: string }
  > {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.warn(`Groq HTTP ${res.status} (${model}): ${errText.slice(0, 240)}`);
        if (this.isQuotaError(res.status, errText)) {
          if (this.isTransientError(res.status, errText) && !/daily|tokens per day|rpd/i.test(errText)) {
            return { ok: false, kind: 'transient', detail: errText };
          }
          return { ok: false, kind: 'quota', detail: errText };
        }
        if (this.isTransientError(res.status, errText)) {
          return { ok: false, kind: 'transient', detail: errText };
        }
        return { ok: false, kind: 'error', detail: errText };
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content || '';
      if (!text.trim()) {
        return { ok: false, kind: 'empty', detail: 'empty response' };
      }
      try {
        return { ok: true, data: JSON.parse(text) as T };
      } catch {
        return { ok: false, kind: 'empty', detail: 'invalid json' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        return { ok: false, kind: 'transient', detail: msg };
      }
      return { ok: false, kind: 'transient', detail: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
