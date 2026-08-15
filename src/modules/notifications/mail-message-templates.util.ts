export type EmailMessageTemplate = {
  subject?: string;
  body?: string;
};

export type EmailMessageTemplates = Record<string, EmailMessageTemplate>;

const PLACEHOLDER = /\{(shop|guest|name|detail|title|body)\}/gi;

export function interpolateMailTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER, (_, key: string) => vars[String(key).toLowerCase()] ?? '');
}

export function applyEmailMessageTemplate(
  templates: EmailMessageTemplates | null | undefined,
  type: string,
  defaults: { title: string; body: string },
  extra?: { shop?: string | null; guest?: string | null; name?: string | null; detail?: string | null },
): { title: string; body: string } {
  const t = templates && typeof templates === 'object' ? templates[type] : undefined;
  const shop = String(extra?.shop ?? '').trim();
  const guest = String(extra?.guest ?? extra?.name ?? '').trim();
  const name = String(extra?.name ?? extra?.guest ?? '').trim();
  const vars: Record<string, string> = {
    shop,
    guest,
    name,
    detail: String(extra?.detail ?? defaults.body ?? ''),
    title: defaults.title,
    body: defaults.body,
  };
  const subject = String(t?.subject ?? '').trim();
  const body = String(t?.body ?? '').trim();
  return {
    title: subject ? interpolateMailTemplate(subject, vars) : defaults.title,
    body: body ? interpolateMailTemplate(body, vars) : defaults.body,
  };
}

export function normalizeEmailMessageTemplates(
  raw?: EmailMessageTemplates | null,
): EmailMessageTemplates | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: EmailMessageTemplates = {};
  for (const [key, value] of Object.entries(raw)) {
    const type = String(key ?? '').trim();
    if (!type || !value || typeof value !== 'object') continue;
    const subject = String((value as EmailMessageTemplate).subject ?? '').trim().slice(0, 200);
    const body = String((value as EmailMessageTemplate).body ?? '').trim().slice(0, 4000);
    if (!subject && !body) continue;
    out[type] = {
      ...(subject ? { subject } : {}),
      ...(body ? { body } : {}),
    };
  }
  return Object.keys(out).length ? out : {};
}
