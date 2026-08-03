import { parseOpeningMinutes } from '../../common/business-date';

export interface WaMessage {
  at: Date;
  author: string;
  body: string;
}

export interface ParsedClosingDraft {
  businessDate: string;
  cardAmount: number;
  cashAmount: number;
  posSystemAmount: number;
  cashLeftInRegister: number;
  cashWithdrawn: number;
  cashWithdrawnByName: string | null;
  unitsSold: number | null;
  declaredTotal?: number;
  notes: string | null;
  expenses: Array<{ label: string; amount: number }>;
  confidence: 'high' | 'medium' | 'low';
  sourceAuthors: string[];
  rawSnippets: string[];
}

const MSG_START =
  /^[\u200e\u200f\ufeff]*\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*([^:]+):\s([\s\S]*)$/;

/** Parsea el _chat.txt de un export de WhatsApp. */
export function parseWhatsAppChat(text: string): WaMessage[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const messages: WaMessage[] = [];
  let current: WaMessage | null = null;

  for (const line of lines) {
    const m = line.match(MSG_START);
    if (m) {
      if (current) messages.push(current);
      const day = Number(m[1]);
      const month = Number(m[2]);
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      const second = Number(m[6] ?? 0);
      current = {
        at: new Date(year, month - 1, day, hour, minute, second),
        author: m[7].trim(),
        body: (m[8] ?? '').trim(),
      };
    } else if (current) {
      current.body += '\n' + line;
    }
  }
  if (current) messages.push(current);
  return messages.filter((msg) => !isSystemNoise(msg.body));
}

function isSystemNoise(body: string): boolean {
  const t = body.toLowerCase();
  return (
    t.includes('end-to-end encrypted') ||
    t.includes('created group') ||
    t.includes('added you') ||
    t.includes('left') && t.length < 40
  );
}

/** Extrae borradores de cierre agrupando mensajes del mismo día laboral. */
export function extractClosingDrafts(
  messages: WaMessage[],
  opts: { openingHour?: number; openingTime?: string | null } = {},
): ParsedClosingDraft[] {
  const buckets = new Map<string, WaMessage[]>();
  const openingMins =
    opts.openingHour != null
      ? Math.min(23, Math.max(0, opts.openingHour)) * 60
      : parseOpeningMinutes(opts.openingTime ?? '05:00');

  for (const msg of messages) {
    if (!looksLikeClosingContent(msg.body)) continue;
    const date = resolveBusinessDate(msg, openingMins);
    if (!date) continue;
    const list = buckets.get(date) ?? [];
    list.push(msg);
    buckets.set(date, list);
  }

  const drafts: ParsedClosingDraft[] = [];
  for (const [businessDate, msgs] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const draft = buildDraft(businessDate, msgs);
    const meaningful =
      draft.cardAmount >= 1000 ||
      draft.cashAmount >= 1000 ||
      draft.posSystemAmount >= 1000;
    if (meaningful) drafts.push(draft);
  }
  return drafts;
}

function looksLikeClosingContent(body: string): boolean {
  const t = body.toLowerCase();
  return (
    /\b(pvs|tpv|efectivo|caja|cierre|dejo|dejan|llevo|lleva|sanguch|paninos?|comensales|suma|total)\b/i.test(
      t,
    ) || /\d[\d.\s]*[,.]?\d*\s*(pvs|tpv|efectivo)/i.test(t)
  );
}

function resolveBusinessDate(msg: WaMessage, openingMins: number): string | null {
  const fromBody = extractDateFromText(msg.body, msg.at);
  if (fromBody) return fromBody;
  const d = new Date(msg.at);
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins < openingMins) d.setDate(d.getDate() - 1);
  return toIsoDate(d);
}

function extractDateFromText(text: string, ref: Date): string | null {
  const fallbackYear = ref.getFullYear();
  const candidates: Date[] = [];
  const patterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g,
    /(?:cierre|caja|pvs|tpv|efectivo|ingresos)[^\d]{0,20}(\d{1,2})\/(\d{1,2})(?!\d)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      let year = m[3] ? Number(m[3]) : fallbackYear;
      if (year < 100) year += 2000;
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      candidates.push(new Date(year, month - 1, day));
    }
  }
  // Fechas sueltas d/m: solo si están cerca del timestamp del mensaje
  const loose = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)];
  for (const m of loose) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const d = new Date(fallbackYear, month - 1, day);
    const diffDays = Math.abs((d.getTime() - ref.getTime()) / 86400000);
    if (diffDays <= 3) candidates.push(d);
  }
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      Math.abs(a.getTime() - ref.getTime()) - Math.abs(b.getTime() - ref.getTime()),
  );
  return toIsoDate(candidates[0]);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDraft(businessDate: string, msgs: WaMessage[]): ParsedClosingDraft {
  const joined = msgs.map((m) => m.body).join('\n');
  const authors = [...new Set(msgs.map((m) => m.author))];

  let cardAmount = firstAmount(joined, [
    /(?:pvs|tpv)[^\n]{0,30}\$\s*([\d.]+(?:,\d{1,2})?)/i,
    /([\d.]+(?:,\d{1,2})?)\s*(?:pvs|tpv)\b/i,
    /(?:pvs|tpv)\s*[:=]?\s*(\d+\s*(?:k|mil))\b/i,
    /(?:pvs|tpv)\s*[:=]?\s*([\d.]+(?:,\d{1,2})?)\b(?!\s*\/)/i,
    /ingresos?\s*pvs[^\d$]*\$?\s*(\d+\s*(?:k|mil)|[\d.]+(?:,\d{1,2})?)/i,
  ]);

  let cashAmount = firstAmount(joined, [
    /efectivo\s*[:=]?\s*(\d+\s*(?:k|mil))\b/i,
    /(\d+\s*(?:k|mil))\s*efectivo\b/i,
    /efectivo\s*[:=]?\s*\$?\s*([\d.]+(?:,\d{1,2})?)/i,
    /([\d.]+(?:,\d{1,2})?)\s*efectivo\b/i,
    /ingresos?\s*efectivo[^\d$]*\$?\s*(\d+\s*(?:k|mil)|[\d.]+(?:,\d{1,2})?)/i,
  ]);

  let posSystemAmount = firstAmount(joined, [
    /\bcaja\s+(\d{5,}(?:[.,]\d{1,2})?)\b/i,
    /\bcaja\s+[^\d$]{0,12}\$\s*([\d.]+(?:,\d{1,2})?)/i,
    /ingresos?\s*caja[^\d$]*\$?\s*([\d.]+(?:,\d{1,2})?|\d{4,})/i,
  ]);

  let cashLeftInRegister = firstAmount(
    joined,
    [
      /(?:dejo|dejan|se\s+deja(?:n)?).{0,40}?(\d+\s*(?:k|mil))\b/i,
      /(?:dejo|dejan|se\s+deja(?:n)?).{0,40}?(\d{4,}(?:[.,]\d{1,2})?)\b/i,
      /(?:dejo|dejan|se\s+deja(?:n)?).{0,40}?\b(\d{1,3})\b(?!\s*\/)/i,
      /cambio\s+en\s+caja[^\d$]{0,15}(\d+\s*(?:k|mil)|\d{1,4})/i,
    ],
    { allowSmall: true },
  );
  if (cashLeftInRegister > 0 && cashLeftInRegister < 500) {
    cashLeftInRegister *= 1000;
  }

  let cashWithdrawn = firstAmount(joined, [
    /(?:me\s+llevo|llevo(?:\s+a\s+[^$\n]{0,40})?)\s*(?:\(efectivo\))?\s*\$?\s*(\d+\s*(?:k|mil))\b/i,
    /(?:me\s+llevo|llevo(?:\s+a\s+[^$\n]{0,40})?)\s*(?:\(efectivo\))?\s*\$\s*([\d.]+(?:,\d{1,2})?)/i,
    /(?:me\s+llevo|llevo(?:\s+a\s+[^$\n]{0,40})?)\s*(?:\(efectivo\))?\s*(\d{4,}(?:[.,]\d{1,2})?)\b/i,
    /(\d+\s*(?:k|mil))\s*efectivo\s+me\s+llevo/i,
  ]);

  if (!cashWithdrawn && cashAmount > 0) {
    const inferred = cashAmount - cashLeftInRegister;
    if (inferred > 0) cashWithdrawn = inferred;
  }

  const unitsSold = (() => {
    const m = joined.match(/(\d+)\s*(?:sanguch|paninos?|unidades)/i);
    return m ? Number(m[1]) : null;
  })();

  const declaredTotal = firstAmount(joined, [
    /(?:suma|total)\s*[:=]?\s*\$?\s*([\d.]+(?:,\d{1,2})?)/i,
    /total\s+(\d{4,}(?:[.,]\d{1,2})?)/i,
  ]);

  const expenses: Array<{ label: string; amount: number }> = [];
  const expenseRe =
    /se\s+gast[oó]\s+(?:efectivo\s+)?en\s+([^\d\n$]{2,40}?)\s*\$?\s*(\d+\s*(?:k|mil)|[\d.]+(?:,\d{1,2})?)/gi;
  let em: RegExpExecArray | null;
  while ((em = expenseRe.exec(joined))) {
    const amount = parseMoneyToken(em[2]);
    if (amount > 0) expenses.push({ label: em[1].trim(), amount });
  }

  const leadExpense = joined.match(
    /llevo\s+a\s+([^(,\n]{2,40}?)\s*(?:\(efectivo\))?\s*\$?\s*(\d+\s*(?:k|mil)|[\d.]+(?:,\d{1,2})?)/i,
  );
  if (leadExpense) {
    const amount = parseMoneyToken(leadExpense[2]);
    if (amount > 0 && !expenses.some((e) => e.amount === amount)) {
      expenses.push({ label: leadExpense[1].trim(), amount });
    }
  }

  let cashWithdrawnByName: string | null = null;
  const whoMatch = joined.match(/se\s+lo\s+lleva\s+([A-Za-zÁÉÍÓÚáéíóúÑñ][\wÁÉÍÓÚáéíóúÑñ .]{1,40})/i);
  if (whoMatch) {
    cashWithdrawnByName = whoMatch[1].trim();
  } else if (cashWithdrawn > 0) {
    const closer = authors.find((a) => /facu|nike|toma|thomas|santiago|font/i.test(a));
    cashWithdrawnByName = closer ?? authors[0] ?? null;
  }

  const hasCore = cardAmount >= 1000 && cashAmount >= 1000;
  const confidence: ParsedClosingDraft['confidence'] = hasCore
    ? cashLeftInRegister > 0 || cashWithdrawn > 0
      ? 'high'
      : 'medium'
    : cardAmount >= 1000 || cashAmount >= 1000
      ? 'medium'
      : 'low';

  const notesParts: string[] = [];
  if (/diferencia|sobrante|descartable|alquiler/i.test(joined)) {
    const noteLine = msgs
      .map((m) => m.body)
      .find((b) => /diferencia|sobrante|descartable|alquiler|dejo todo/i.test(b));
    if (noteLine) notesParts.push(noteLine.replace(/\*?image omitted\*?/gi, '').trim().slice(0, 280));
  }

  return {
    businessDate,
    cardAmount,
    cashAmount,
    posSystemAmount: posSystemAmount || (cardAmount + cashAmount || 0),
    cashLeftInRegister,
    cashWithdrawn,
    cashWithdrawnByName,
    unitsSold,
    declaredTotal: declaredTotal || undefined,
    notes: notesParts.length ? notesParts.join(' | ') : null,
    expenses,
    confidence,
    sourceAuthors: authors,
    rawSnippets: msgs
      .map((m) => m.body.replace(/\*?image omitted\*?/gi, '').trim())
      .filter(Boolean)
      .slice(0, 6),
  };
}

function firstAmount(
  text: string,
  patterns: RegExp[],
  opts?: { allowSmall?: boolean },
): number {
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const n = parseMoneyToken(m[1]);
    if (n <= 0) continue;
    if (!opts?.allowSmall && n < 100 && !/k|mil/i.test(m[1])) continue;
    // Evitar capturar el año del mensaje (ej. 2026) como PVS
    if (!opts?.allowSmall && n >= 2000 && n <= 2035 && !/[.,]|k|mil/i.test(m[1])) continue;
    return n;
  }
  return 0;
}

/** Interpreta montos UY: 225.200,00 | 67k | 148mil | 119000 */
export function parseMoneyToken(raw: string): number {
  let s = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/^\$/, '');
  if (!s) return 0;

  const mil = s.match(/^([\d.,]+)mil$/);
  if (mil) return Math.round(parsePlainNumber(mil[1]) * 1000);

  const k = s.match(/^([\d.,]+)k$/);
  if (k) return Math.round(parsePlainNumber(k[1]) * 1000);

  return Math.round(parsePlainNumber(s));
}

function parsePlainNumber(s: string): number {
  // 225.200,00 → 225200.00 ; 225,200.00 → 225200 ; 119000 → 119000
  if (/\.\d{3},\d{1,2}$/.test(s) || /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }
  if (/,\d{3}\.\d{1,2}$/.test(s) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    return Number(s.replace(/,/g, ''));
  }
  if (/^\d+,\d{1,2}$/.test(s)) {
    return Number(s.replace(',', '.'));
  }
  if (/^\d+\.\d{1,2}$/.test(s) && !/\.\d{3}/.test(s)) {
    return Number(s);
  }
  return Number(s.replace(/[^\d.]/g, '')) || 0;
}
